"""Exercise signing context without a real key or GPG agent."""

import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

HELPER = Path(os.environ.get(
    "YKNOTIFY_CONTEXT_HELPER",
    Path(__file__).resolve().parents[1] / "modules/home/darwin/yknotify/context.py",
))


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = dict(os.environ, HOME=self.temp.name,
                        YKNOTIFY_DIAGNOSTICS="0")

    def command(self, *args):
        return [sys.executable, str(HELPER), *args]

    def describe(self, kind="OpenPGP"):
        return subprocess.check_output(
            self.command("describe", kind), env=self.env, text=True
        ).strip()

    def start(self, duration=60):
        child = subprocess.Popen(
            self.command("wrap", sys.executable, "-c",
                         f"import time; time.sleep({duration})", "--detach-sign"),
            env=self.env,
        )
        self.addCleanup(lambda: self.stop(child))
        return child

    @staticmethod
    def stop(child):
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)

    def wait_for(self, expected):
        for _ in range(100):
            if self.describe() == expected:
                return
            time.sleep(0.03)
        self.fail(self.describe())

    def test_pending_overlap_and_cleanup(self):
        self.assertEqual(self.describe(), "Requester unknown")
        first = self.start()
        self.wait_for("Git signing pending — touch requester unverified")
        self.assertEqual(self.describe("FIDO2"), "Requester unknown")
        second = self.start()
        self.wait_for("Multiple Git signing requests pending — touch requester unverified")
        self.stop(first)
        self.assertEqual(first.returncode, 128 + signal.SIGTERM)
        self.wait_for("Git signing pending — touch requester unverified")
        self.stop(second)
        self.wait_for("Requester unknown")

    def test_preserves_streams_arguments_and_failure(self):
        result = subprocess.run(
            self.command("wrap", sys.executable, "-c",
                         "import sys; print(sys.argv[1]); "
                         "sys.stdout.buffer.write(sys.stdin.buffer.read()); "
                         "print('diagnostic', file=sys.stderr); sys.exit(7)",
                         "--detach-sign"),
            input=b"signing input\n", capture_output=True, env=self.env,
        )
        self.assertEqual(result.returncode, 7)
        self.assertIn(b"signing input\n", result.stdout)
        self.assertIn(b"--detach-sign", result.stdout)
        self.assertEqual(result.stderr, b"diagnostic\n")
        self.assertEqual(self.describe(), "Requester unknown")

    def test_killed_wrapper_is_not_pending(self):
        child = self.start(duration=2)
        self.wait_for("Git signing pending — touch requester unverified")
        child.send_signal(signal.SIGKILL)
        child.wait(timeout=5)
        self.wait_for("Requester unknown")
        time.sleep(2.2)  # Allow the short-lived orphaned fake signer to exit.

    def test_context_failure_does_not_break_signing(self):
        directory = Path(self.temp.name) / "Library/Caches/yknotify-requests"
        directory.parent.mkdir(parents=True)
        directory.write_text("not a directory")
        result = subprocess.run(
            self.command("wrap", sys.executable, "-c", "print('signed')",
                         "--detach-sign"),
            env=self.env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "signed\n")
        self.assertEqual(self.describe(), "Requester unknown")

    def test_git_signing_end_to_end_with_fake_gpg(self):
        root = Path(self.temp.name)
        fake = root / "fake-gpg"
        release = root / "release"
        fake.write_text(
            f"#!{sys.executable}\n"
            "import pathlib, sys, time\n"
            "sys.stdin.buffer.read()\n"
            f"while not pathlib.Path({str(release)!r}).exists():\n"
            "    time.sleep(0.02)\n"
            "print('[GNUPG:] SIG_CREATED D 1 10 00 0 TEST', file=sys.stderr)\n"
            "print('-----BEGIN PGP SIGNATURE-----\\nfake\\n"
            "-----END PGP SIGNATURE-----')\n"
        )
        fake.chmod(0o700)
        wrapper = root / "signer"
        # Match the packaged wrapper's invocation without using a real key.
        wrapper.write_text(
            "#!/bin/sh\nexec "
            + shlex.join(self.command("wrap", str(fake))) + ' "$@"\n'
        )
        wrapper.chmod(0o700)
        env = dict(self.env, GIT_CONFIG_GLOBAL=os.devnull,
                   GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="Test",
                   GIT_AUTHOR_EMAIL="test@example.invalid",
                   GIT_COMMITTER_NAME="Test",
                   GIT_COMMITTER_EMAIL="test@example.invalid")
        repo = root / "repo"
        subprocess.run(["git", "init", "-q", str(repo)], env=env, check=True)
        tree = subprocess.check_output(
            ["git", "mktree"], input=b"", cwd=repo, env=env
        ).decode().strip()
        child = subprocess.Popen(
            ["git", "-c", f"gpg.openpgp.program={wrapper}",
             "-c", "user.signingkey=test", "commit-tree", "-S", tree,
             "-m", "Test"], cwd=repo, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.addCleanup(lambda: self.stop(child))
        self.addCleanup(release.touch)
        self.wait_for("Git signing pending — touch requester unverified")
        release.touch()
        stdout, stderr = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(len(stdout.strip()), 40)
        self.wait_for("Requester unknown")

    def test_non_signing_calls_are_not_tracked(self):
        child = subprocess.Popen(
            self.command("wrap", sys.executable, "-c",
                         "import time; time.sleep(1)", "--verify"),
            env=self.env,
        )
        self.addCleanup(lambda: self.stop(child))
        time.sleep(0.2)
        self.assertEqual(self.describe(), "Requester unknown")
        child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
