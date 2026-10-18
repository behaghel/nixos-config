"""Naming behavior against native-command fixtures, never a real router."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(sys.argv.pop(1)).read_text()
ACTIVATION = Path(sys.argv.pop(1)).read_text()


class NamingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.kernel = self.root / "hostname"
        self.kernel.write_text("GL-MT3000\n")
        self.state = self.root / "state.json"
        self.original = {
            "uci": "GL-MT3000", "host": "GL-MT3000",
            "dns": "gl-mt3000.example.ts.net.", "id": "node-existing",
            "pending": "", "calls": [], "unrelated": "keep",
        }
        self.state.write_text(json.dumps(self.original))
        # Every mutating native command records only its intended effect.
        mock = self.bin / "mock"
        mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ["FIXTURE_STATE"])
s = json.loads(p.read_text())
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "id":
    print(0)
elif name == "uci":
    if args[:2] == ["-q", "get"]:
        print(s["uci"])
    elif args == ["changes", "system"]:
        print(s["pending"], end="")
    elif args[0] == "set":
        s["uci"] = args[1].split("=", 1)[1]
        s["calls"].append([name] + args)
    elif args == ["commit", "system"]:
        s["calls"].append([name] + args)
    else:
        sys.exit("unexpected UCI command: " + repr(args))
elif name == "tailscale":
    if args == ["status", "--json"]:
        print(json.dumps({"BackendState": "Running", "Self": {
            "HostName": s["host"], "DNSName": s["dns"], "ID": s["id"]}}))
    elif args[0] == "set":
        if s.get("fail_set"):
            sys.exit(1)
        s["host"] = args[1].split("=", 1)[1]
        if not s.get("conflict"):
            s["dns"] = s["host"] + ".example.ts.net."
        s["calls"].append([name] + args)
    else:
        sys.exit("unexpected tailscale command: " + repr(args))
elif name == "jsonfilter":
    value = json.load(sys.stdin)
    for key in args[1].removeprefix("@.").split("."):
        value = value[key]
    print(value)
p.write_text(json.dumps(s))
''')
        mock.chmod(0o755)
        for name in ["id", "uci", "tailscale", "jsonfilter"]:
            (self.bin / name).symlink_to(mock)
        self.script = self.root / "naming.sh"
        self.script.write_text(SCRIPT.replace(
            "/proc/sys/kernel/hostname", str(self.kernel),
        ))
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        FIXTURE_STATE=str(self.state), desired_name="beryl-ax")

    def run_script(self, mode):
        return subprocess.run(["sh", str(self.script), mode], env=self.env,
                              text=True, capture_output=True)

    def state_value(self):
        return json.loads(self.state.read_text())

    def update(self, **values):
        self.state.write_text(json.dumps(self.state_value() | values))

    def test_check_reports_drift_without_writes(self):
        result = self.run_script("check")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state_value(), self.original)
        self.assertEqual(self.kernel.read_text(), "GL-MT3000\n")

    def test_apply_renames_in_place_and_second_apply_is_noop(self):
        result = self.run_script("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        first = self.state_value()
        self.assertEqual(first["uci"], "beryl-ax")
        self.assertEqual(first["host"], "beryl-ax")
        self.assertEqual(first["id"], "node-existing")
        self.assertEqual(first["unrelated"], "keep")
        self.assertEqual(self.kernel.read_text().strip(), "beryl-ax")
        self.assertEqual(self.run_script("check").returncode, 0)
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.state_value(), first)

    def test_pending_uci_changes_block_apply(self):
        self.update(pending="system.other.timezone='changed'\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.state_value()["calls"], [])
        self.assertEqual(self.kernel.read_text(), "GL-MT3000\n")

    def test_tailscale_failure_restores_native_name(self):
        self.update(fail_set=True)
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.state_value()["uci"], "GL-MT3000")
        self.assertEqual(self.kernel.read_text().strip(), "GL-MT3000")

    def test_conflicting_tailnet_name_is_not_reported_as_success(self):
        self.update(conflict=True)
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.state_value()["id"], "node-existing")

    def test_unknown_mode_does_not_write(self):
        self.assertNotEqual(self.run_script("typo").returncode, 0)
        self.assertEqual(self.state_value(), self.original)


class TransportTests(unittest.TestCase):
    def test_generated_wrapper_passes_exact_target_and_read_only_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "args.json"
            ssh = root / "ssh"
            ssh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
pathlib.Path(os.environ["ARG_LOG"]).write_text(json.dumps(sys.argv[1:]))
''')
            ssh.chmod(0o755)
            script = root / "activate"
            # Substitute only the transport executable, retaining generated
            # quoting, parsing, options, and the actual input artifact.
            script.write_text(ACTIVATION.replace(
                "exec ssh ", 'exec "$FIXTURE_SSH" ',
            ))
            env = dict(os.environ, FIXTURE_SSH=str(ssh), ARG_LOG=str(log))
            result = subprocess.run(
                ["bash", str(script), "--check", "--target", "100.101.32.55"],
                env=env, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            args = json.loads(log.read_text())
            self.assertEqual(args[-2:], ["100.101.32.55", "sh -s -- check"])
            self.assertEqual(args[0:4], ["-F", "/dev/null", "-l", "root"])
            self.assertIn("HostKeyAlias=beryl-ax", args)
            self.assertIn("StrictHostKeyChecking=yes", args)


if __name__ == "__main__":
    unittest.main()
