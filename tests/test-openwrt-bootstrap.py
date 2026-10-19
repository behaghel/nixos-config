"""Exercise the generated native script without touching a real router."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(sys.argv.pop(1)).read_text()
KEY = " ".join(os.environ["TEST_PUBLIC_KEY"].split()[:2])


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.server = self.root / "etc/dropbear"
        self.server.mkdir(parents=True)
        self.keys = self.server / "authorized_keys"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "commands"
        for name, body in {
            "id": "echo 0",
            "uci": 'echo "$*" >> "$COMMAND_LOG"; echo dropbear',
            "dropbear": "exit 0",
        }.items():
            executable = self.bin / name
            executable.write_text("#!/bin/sh\n" + body + "\n")
            executable.chmod(0o755)
        self.script = self.root / "bootstrap.sh"
        self.script.write_text(
            SCRIPT.replace("/etc/dropbear", str(self.server))
        )
        self.env = dict(
            os.environ,
            PATH=f"{self.bin}:{os.environ['PATH']}",
            COMMAND_LOG=str(self.log),
            managed_keys=os.environ["TEST_PUBLIC_KEY"],
        )

    def run_script(self, mode):
        return subprocess.run(
            ["sh", str(self.script), mode],
            env=self.env, text=True, capture_output=True,
        )

    def test_preview_is_read_only(self):
        before = sorted(self.server.iterdir())
        result = self.run_script("check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("missing", result.stderr)
        self.assertEqual(sorted(self.server.iterdir()), before)
        self.assertNotIn("set", self.log.read_text())

    def test_apply_preserves_keys_and_is_idempotent(self):
        existing = "# existing operator\nssh-ed25519 AAAAother retained"
        self.keys.write_text(existing)  # no trailing newline
        self.keys.chmod(0o644)
        self.assertEqual(self.run_script("apply").returncode, 0)
        first = self.keys.read_bytes()
        first_stat = self.keys.stat()
        self.assertIn(existing, first.decode())
        self.assertIn(KEY, first.decode())
        self.assertEqual(first_stat.st_mode & 0o777, 0o600)
        self.assertEqual(self.server.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.keys.read_bytes(), first)
        self.assertEqual(self.keys.stat().st_mtime_ns, first_stat.st_mtime_ns)
        self.assertNotIn("commit", self.log.read_text())

    def test_same_key_with_different_comment_not_duplicated(self):
        self.keys.write_text(KEY + " cardno:existing\n")
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.keys.read_text().count(KEY), 1)

    def test_restricted_key_is_not_silently_made_unrestricted(self):
        restricted = 'from="192.168.8.0/24" ' + KEY + " restricted\n"
        self.keys.write_text(restricted)
        result = self.run_script("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.keys.read_text(), restricted)

    def test_duplicate_managed_identity_is_written_once(self):
        self.script.write_text(self.script.read_text().replace(
            "set -eu", 'managed_keys="$managed_keys\n$managed_keys"\nset -eu',
            1,
        ))
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.keys.read_text().count(KEY), 1)

    def test_non_root_fails_before_writing(self):
        (self.bin / "id").write_text("#!/bin/sh\necho 1000\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertFalse(self.keys.exists())

    def test_missing_native_server_fails_before_writing(self):
        (self.bin / "uci").write_text("#!/bin/sh\nexit 1\n")
        result = self.run_script("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.keys.exists())

    def test_refuses_symlink_key_file(self):
        other = self.root / "unrelated"
        other.write_text("keep me\n")
        self.keys.symlink_to(other)
        result = self.run_script("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(other.read_text(), "keep me\n")

    def test_unknown_mode_does_not_write(self):
        result = self.run_script("typo")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.keys.exists())


if __name__ == "__main__":
    unittest.main()
