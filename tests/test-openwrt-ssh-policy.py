"""Exercise native SSH policy with isolated UCI and listener fixtures."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(sys.argv.pop(1)).read_text()
KEY = os.environ["TEST_PUBLIC_KEY"]


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.keys = self.root / "authorized_keys"
        self.keys.write_text(KEY + "\n")
        self.run = self.root / "run"
        self.run.mkdir()
        (self.run / "dropbear.main.pid").write_text("123\n")
        self.proc = self.root / "proc/123"
        self.proc.mkdir(parents=True)
        (self.proc / "cmdline").write_bytes(b"\0".join([b"/usr/sbin/dropbear", b"-F", b"-p", b"22", b""]))
        self.state = self.root / "state.json"
        self.original = {
            "values": {"dropbear.main.PasswordAuth": "on",
                       "dropbear.main.RootPasswordAuth": "on",
                       "dropbear.main.Port": "22"},
            "sections": ["dropbear.main"], "calls": [], "pending": "",
        }
        self.state.write_text(json.dumps(self.original))
        mock = self.bin / "mock"
        mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ["FIXTURE_STATE"])
s = json.loads(p.read_text())
a = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
if name == "id":
    print(0)
elif name == "sleep":
    pass
elif name == "uci":
    if a[:2] == ["changes", "dropbear"]:
        print(s["pending"], end="")
    elif a == ["show", "dropbear"]:
        for section in s["sections"]:
            print(section + "=dropbear")
    elif a[:2] == ["-q", "get"]:
        if a[2] not in s["values"]:
            sys.exit(1)
        print(s["values"][a[2]])
    elif a[0] == "set":
        key, value = a[1].split("=", 1)
        s["values"][key] = value
        s["calls"].append([name] + a)
    elif a[:2] == ["-q", "delete"]:
        s["values"].pop(a[2], None)
        s["calls"].append([name] + a)
    elif a == ["commit", "dropbear"]:
        s["calls"].append([name] + a)
    else:
        sys.exit("unexpected UCI: " + repr(a))
elif name == "service":
    s["calls"].append([name] + a)
    if s.get("fail_reload"):
        p.write_text(json.dumps(s))
        sys.exit(1)
    args = [b"/usr/sbin/dropbear", b"-F", b"-p", b"22"]
    if s["values"].get("dropbear.main.PasswordAuth") == "off":
        args.append(b"-s")
    if s["values"].get("dropbear.main.RootPasswordAuth") == "off":
        args.append(b"-g")
    if not s.get("stale_reload"):
        pathlib.Path(os.environ["LISTENER"]).write_bytes(b"\\0".join(args) + b"\\0")
p.write_text(json.dumps(s))
''')
        mock.chmod(0o755)
        for name in ["id", "uci", "sleep", "service"]:
            (self.bin / name).symlink_to(mock)
        self.script = self.root / "policy.sh"
        self.script.write_text(
            SCRIPT.replace("/etc/dropbear/authorized_keys", str(self.keys))
            .replace("/etc/init.d/dropbear", str(self.bin / "service"))
            .replace("/var/run/dropbear.", str(self.run / "dropbear."))
            .replace("/proc/", str(self.root / "proc") + "/")
        )
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        FIXTURE_STATE=str(self.state),
                        LISTENER=str(self.proc / "cmdline"),
                        operator_key=KEY)

    def run_script(self, mode):
        return subprocess.run(["sh", str(self.script), mode], env=self.env,
                              capture_output=True, text=True)

    def current(self):
        return json.loads(self.state.read_text())

    def update(self, **values):
        self.state.write_text(json.dumps(self.current() | values))

    def test_check_is_read_only_and_detects_password_access(self):
        self.assertNotEqual(self.run_script("check").returncode, 0)
        self.assertEqual(self.current(), self.original)

    def test_apply_hardens_configuration_and_live_listener_idempotently(self):
        result = self.run_script("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        first = self.current()
        self.assertEqual(first["values"]["dropbear.main.PasswordAuth"], "off")
        self.assertEqual(first["values"]["dropbear.main.RootPasswordAuth"], "off")
        self.assertEqual(first["values"]["dropbear.main.Port"], "22")
        self.assertEqual(self.keys.read_text(), KEY + "\n")
        self.assertEqual(self.run_script("check").returncode, 0)
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current(), first)

    def test_hardens_every_configured_instance(self):
        self.update(sections=["dropbear.main", "dropbear.guest"])
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["values"]["dropbear.guest.PasswordAuth"], "off")
        self.assertEqual(self.current()["values"]["dropbear.guest.RootPasswordAuth"], "off")

    def test_stale_listener_is_not_mistaken_for_compliance(self):
        self.update(values={key: ("off" if key.endswith("Auth") else value)
                            for key, value in self.original["values"].items()})
        self.assertNotEqual(self.run_script("check").returncode, 0)
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.run_script("check").returncode, 0)

    def test_pending_configuration_blocks_changes(self):
        self.update(pending="dropbear.main.Port='2222'\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["calls"], [])

    def test_missing_operator_key_blocks_cutover(self):
        self.keys.write_text("ssh-ed25519 OTHER\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["calls"], [])

    def test_reload_failure_restores_previous_options_including_absent_fields(self):
        self.update(values={"dropbear.main.Port": "22"}, fail_reload=True)
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["values"], {"dropbear.main.Port": "22"})

    def test_unverified_live_flags_trigger_rollback(self):
        self.update(stale_reload=True)
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["values"], self.original["values"])

    def test_disabled_root_login_blocks_reload(self):
        self.update(values=self.original["values"] |
                    {"dropbear.main.RootLogin": "off"})
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.current()["calls"], [])

    def test_one_unhardened_listener_is_not_accepted(self):
        self.assertEqual(self.run_script("apply").returncode, 0)
        (self.run / "dropbear.other.pid").write_text("124\n")
        other = self.root / "proc/124"
        other.mkdir()
        (other / "cmdline").write_bytes(b"/usr/sbin/dropbear\0-F\0")
        self.assertNotEqual(self.run_script("check").returncode, 0)

    def test_unknown_mode_never_writes(self):
        self.assertNotEqual(self.run_script("typo").returncode, 0)
        self.assertEqual(self.current(), self.original)


if __name__ == "__main__":
    unittest.main()
