#!/usr/bin/env python3
"""Exercise the interactive publisher with Git and an isolated npm transport."""

import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(os.environ.get(
    "PI_PUBLISH_TEST_SCRIPT",
    Path(__file__).resolve().parents[1] / "scripts/pi_publish.py",
))

NPM = r'''import base64, hashlib, io, json, os, pathlib, sys, tarfile
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with (root / 'calls.jsonl').open('a') as f:
    f.write(json.dumps(args) + '\n')
mode = os.environ.get('FIXTURE_MODE', '')
if args[0] == 'config':
    print('undefined' if ':registry' in args[2] else 'https://registry.npmjs.org/')
elif args[0] == 'pack':
    if mode == 'malformed-pack':
        print('original malformed pack output')
        sys.exit(0)
    manifest = json.loads(pathlib.Path('package.json').read_text())
    name = 'fixture.tgz'
    path = pathlib.Path(args[args.index('--pack-destination') + 1]) / name
    data = json.dumps(manifest).encode()
    with tarfile.open(path, 'w:gz') as archive:
        entry = tarfile.TarInfo('package/package.json')
        entry.size = len(data)
        archive.addfile(entry, io.BytesIO(data))
    integrity = 'sha512-' + base64.b64encode(
        hashlib.sha512(path.read_bytes()).digest()).decode()
    (root / 'integrity').write_text(integrity)
    print(json.dumps([dict(name=manifest['name'], version=manifest['version'],
        filename=name, integrity=integrity,
        files=[dict(path='package.json', size=len(data))])]))
elif args[0] == 'whoami':
    if mode == 'login' and not (root / 'logged-in').exists():
        print('E401 original authentication failure', file=sys.stderr)
        sys.exit(1)
    print('fixture-publisher')
elif args[0] == 'login':
    (root / 'logged-in').touch()
elif args[0] == 'publish':
    if mode == 'publish-failure':
        print('ECONNRESET original publish acknowledgement lost', file=sys.stderr)
        sys.exit(57)
    (root / 'published').touch()
elif args[0] == 'view':
    if mode == 'malformed-registry':
        print('original malformed registry output')
        sys.exit(0)
    if mode == 'verification-failure':
        print('E503 original registry read failure', file=sys.stderr)
        sys.exit(23)
    print(json.dumps(dict(version='1.2.3', dist=dict(integrity=(
        'sha512-different' if mode == 'mismatch' else
        (root / 'integrity').read_text())))))
elif args[0] == 'test' and mode == 'test-failure':
    print('original fixture test failure', file=sys.stderr)
    sys.exit(19)
elif args[0] not in ['ci', 'test']:
    print('Unexpected fake npm command', args, file=sys.stderr)
    sys.exit(99)
'''


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pi-publish-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        shutil.copyfile(SCRIPT, self.root / "scripts/pi_publish.py")
        self.package = self.root / "marketplace/plugins/domain-tree"
        self.package.mkdir(parents=True)
        (self.package / "package.json").write_text(json.dumps({
            "name": "@fixture/domain-tree", "version": "1.2.3",
            "pi": {"skills": ["./skills"]},
            "scripts": {"test": "fixture test"},
        }))
        (self.package / "package-lock.json").write_text("{}")
        (self.root / "bin").mkdir()
        npm = self.root / "bin/npm"
        npm.write_text(f"#!{sys.executable}\n" + NPM)
        npm.chmod(0o700)
        self.env = {
            **os.environ,
            "PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"],
            "FIXTURE_ROOT": str(self.root),
            "DEVENV_ROOT": str(self.root),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        self.git("init", "-q", "-b", "feat/publisher-fixture")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c",
                 "user.email=fixture@example.invalid", "commit", "-qm", "seed")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args], env=self.env,
            check=True, capture_output=True, text=True,
        )

    def command(self):
        command = os.environ.get("PI_PUBLISH_TEST_COMMAND")
        if command:
            return [command]
        return [sys.executable, str(self.root / "scripts/pi_publish.py"),
                "domain-tree"]

    def calls(self):
        path = self.root / "calls.jsonl"
        return [json.loads(row) for row in path.read_text().splitlines()] \
            if path.exists() else []

    def interact(self, answers, mode=""):
        master, slave = pty.openpty()
        process = subprocess.Popen(
            self.command(), stdin=slave, stdout=slave, stderr=slave,
            env={**self.env, "FIXTURE_MODE": mode},
        )
        os.close(slave)
        output = ""
        pending = list(answers)
        deadline = time.monotonic() + 15
        try:
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    output += data.decode()
                    if pending and pending[0][0] in output:
                        _, answer = pending.pop(0)
                        os.write(master, (answer + "\n").encode())
                elif process.poll() is not None:
                    break
            try:
                code = process.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                process.kill()
                self.fail("Publisher did not finish: " + output)
            return code, output
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            os.close(master)

    def test_confirms_exact_tarball_and_verifies_registry(self):
        code, output = self.interact([
            ("Type @fixture/domain-tree@1.2.3", "@fixture/domain-tree@1.2.3"),
        ])
        self.assertEqual(code, 0, output)
        self.assertIn("package.json", output)
        self.assertIn("fixture-publisher", output)
        self.assertIn("Verified", output)
        commands = self.calls()
        self.assertEqual([c[0] for c in commands].count("publish"), 1)
        published = next(c for c in commands if c[0] == "publish")
        self.assertTrue(published[1].endswith(".tgz"))
        self.assertLess([c[0] for c in commands].index("test"),
                        [c[0] for c in commands].index("publish"))

    def test_cancellation_never_publishes(self):
        code, output = self.interact([("Type @fixture/domain-tree@1.2.3", "no")])
        self.assertEqual(code, 0, output)
        self.assertIn("Cancelled", output)
        self.assertNotIn("publish", [c[0] for c in self.calls()])

    def test_login_is_optional_and_explicit(self):
        code, output = self.interact([
            ("Run npm login", "y"),
            ("Type @fixture/domain-tree@1.2.3", "@fixture/domain-tree@1.2.3"),
        ], "login")
        self.assertEqual(code, 0, output)
        self.assertIn("E401 original authentication failure", output)
        self.assertIn("login", [c[0] for c in self.calls()])

    def test_refuses_noninteractive_input(self):
        result = subprocess.run(
            self.command(), input="@fixture/domain-tree@1.2.3\n",
            env=self.env, capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("terminal", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_dirty_package_is_not_published(self):
        with (self.package / "package.json").open("a") as f:
            f.write("\n")
        code, output = self.interact([])
        self.assertNotEqual(code, 0)
        self.assertIn("uncommitted", output)
        self.assertEqual(self.calls(), [])

    def test_failed_checks_stop_before_publishing(self):
        code, output = self.interact([], "test-failure")
        self.assertNotEqual(code, 0)
        self.assertIn("original fixture test failure", output)
        self.assertNotIn("publish", [c[0] for c in self.calls()])

    def test_publish_failure_preserves_uncertainty_and_original_cause(self):
        code, output = self.interact([
            ("Type @fixture/domain-tree@1.2.3", "@fixture/domain-tree@1.2.3"),
        ], "publish-failure")
        self.assertNotEqual(code, 0)
        self.assertIn("ECONNRESET original publish acknowledgement lost", output)
        self.assertIn("not confirmed", output)
        self.assertNotIn("Verified", output)
        self.assertEqual([c[0] for c in self.calls()].count("publish"), 1)

    def test_registry_failure_or_mismatch_is_not_reported_as_verified(self):
        for mode in ["verification-failure", "mismatch", "malformed-registry"]:
            with self.subTest(mode=mode):
                code, output = self.interact([
                    ("Type @fixture/domain-tree@1.2.3", "@fixture/domain-tree@1.2.3"),
                ], mode)
                self.assertNotEqual(code, 0)
                self.assertIn("verification", output.lower())
                self.assertNotIn("Verified", output)

    def test_malformed_pack_output_remains_visible_without_publication(self):
        code, output = self.interact([], "malformed-pack")
        self.assertNotEqual(code, 0)
        self.assertIn("original malformed pack output", output)
        self.assertNotIn("publish", [c[0] for c in self.calls()])

    def test_non_public_metadata_is_not_overridden(self):
        for field in [{"private": True},
                      {"publishConfig": {"access": "restricted"}}]:
            with self.subTest(field=field):
                path = self.package / "package.json"
                manifest = json.loads(path.read_text())
                manifest.pop("private", None)
                manifest.update(field)
                path.write_text(json.dumps(manifest))
                code, output = self.interact([])
                self.assertNotEqual(code, 0)
                self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
