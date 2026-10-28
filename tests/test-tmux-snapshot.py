"""Failure and health tests use a private tmux socket and fake notifier."""

import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ["SNAPSHOT_SOURCE"])
spec = importlib.util.spec_from_file_location("snapshot", SOURCE)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


class SnapshotHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.socket = str(self.root / "tmux.sock")
        self.directory = self.root / "backups"
        self.directory.mkdir()
        self.alerts = self.root / "alerts"
        notifier = self.root / "hub-notify"
        notifier.write_text(
            "#!/bin/sh\nprintf '%s|%s\\n' \"$1\" \"$2\" >> \"$ALERT_LOG\"\n"
        )
        notifier.chmod(0o700)
        self.env = {
            "TMUX_SNAPSHOT_ROOT": str(self.root),
            "TMUX_SNAPSHOT_SAVE_SCRIPT": os.environ["SAVE_SCRIPT"],
            "TMUX_SNAPSHOT_NOTIFY": str(notifier),
            "ALERT_LOG": str(self.alerts),
            "HOME": str(self.root),
            "HISTFILE": "/dev/null",
        }
        self.environment = patch.dict(os.environ, self.env)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.tmux("-f", "/dev/null", "new-session", "-d", "-s", "private",
                  "-c", str(self.root), shutil.which("bash"))
        self.addCleanup(self.stop_server)
        self.tmux("set", "-g", "@resurrect-dir", str(self.directory))
        self.tmux("set", "-g", "@resurrect-capture-pane-contents", "on")
        self.tmux("send-keys", "echo snapshot-content", "Enter")
        self.args = ["--socket", self.socket]

    def tmux(self, *args):
        return subprocess.run(
            ["tmux", "-S", self.socket, *args], check=True,
            capture_output=True, text=True,
        ).stdout.strip()

    def stop_server(self):
        result = subprocess.run(
            ["tmux", "-S", self.socket, "list-panes", "-a", "-F",
             "#{pane_pid}"], capture_output=True, text=True,
        )
        subprocess.run(["tmux", "-S", self.socket, "kill-server"],
                       capture_output=True)
        # Allow pane shells to finish before removing their HOME directory.
        for pid in result.stdout.splitlines():
            for _ in range(100):
                try:
                    os.kill(int(pid), 0)
                except ProcessLookupError:
                    break
                time.sleep(0.02)

    def save(self):
        self.assertEqual(snapshot.main(self.args), 0)

    def good_files(self):
        return ((self.directory / "last").read_bytes(),
                (self.directory / "pane_contents.tar.gz").read_bytes())

    def fake_saver(self, body):
        script = self.root / "save.sh"
        script.write_text(body)
        os.environ["TMUX_SNAPSHOT_SAVE_SCRIPT"] = str(script)

    def test_background_children_do_not_corrupt_saved_commands(self):
        self.tmux("send-keys", "sleep 731 & sleep 732 & wait", "Enter")
        pid = self.tmux("display-message", "-p", "#{pane_pid}")
        for _ in range(100):
            processes = subprocess.check_output(
                ["ps", "-axo", "ppid=,command="], text=True,
            )
            children = [line.split(None, 1)[1]
                        for line in processes.splitlines()
                        if line.split() and line.split()[0] == pid]
            if len(children) >= 2:
                break
            time.sleep(0.02)
        self.assertGreaterEqual(len(children), 2)
        self.save()
        records = (self.directory / "last").read_text().splitlines()
        self.assertEqual(sum(r.startswith("pane\t") for r in records), 1)
        self.assertTrue(all(r.split("\t")[0] in
                            {"pane", "window", "state"} for r in records))
        pane = next(r for r in records if r.startswith("pane\t"))
        self.assertEqual(pane.split("\t")[10], ":")
        self.assertFalse(self.alerts.exists())

    def test_foreground_command_is_saved_without_background_helper(self):
        self.tmux("send-keys", "sleep 731 & sleep 732", "Enter")
        pid = self.tmux("display-message", "-p", "#{pane_pid}")
        for _ in range(100):
            if snapshot.pane_command(pid) == "sleep 732":
                break
            time.sleep(0.02)
        self.assertEqual(snapshot.pane_command(pid), "sleep 732")
        self.save()
        records = (self.directory / "last").read_text().splitlines()
        pane = next(r for r in records if r.startswith("pane\t"))
        self.assertEqual(pane.split("\t")[10], ":sleep 732")
        self.assertNotIn("sleep 731", "\n".join(records))

    def test_failed_save_preserves_both_files_and_notifies_once(self):
        self.save()
        previous = self.good_files()
        self.fake_saver('echo deliberate-failure >&2; exit 1\n')
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)
        alerts = self.alerts.read_text().splitlines()
        self.assertEqual(len(alerts), 1)
        self.assertIn("Tmux backup failed", alerts[0])

    def test_legacy_flat_backup_is_preserved_during_migration(self):
        env = dict(os.environ)
        pid = self.tmux("display-message", "-p", "#{pid}")
        env["TMUX"] = f"{self.socket},{pid},0"
        env.pop("TMUX_TMPDIR", None)
        subprocess.run(["bash", os.environ["SAVE_SCRIPT"], "quiet"],
                       env=env, check=True)
        previous = self.good_files()
        self.save()
        legacy = next((self.directory / ".snapshots").glob("legacy-*"))
        self.assertEqual((legacy / "last").read_bytes(), previous[0])
        self.assertEqual((legacy / "pane_contents.tar.gz").read_bytes(),
                         previous[1])

    def test_unwritable_health_storage_still_notifies(self):
        self.save()
        previous = self.good_files()
        shutil.rmtree(self.directory / ".health")
        (self.directory / ".health").write_text("not a directory")
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)
        self.assertIn("Tmux backup failed", self.alerts.read_text())

    def test_zero_exit_with_incomplete_layout_is_rejected(self):
        self.save()
        previous = self.good_files()
        self.fake_saver(
            'dir=$(tmux show-option -gqv @resurrect-dir)\n'
            'printf "pane\\tpartial\\n" > "$dir/incomplete"\n'
            'ln -s incomplete "$dir/last"\n'
        )
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)
        self.assertTrue(self.alerts.exists())

    def test_zero_exit_with_a_missing_pane_is_rejected(self):
        self.save()
        previous = self.good_files()
        self.fake_saver(
            'bash "$SAVE_SCRIPT" quiet\n'
            'dir=$(tmux show-option -gqv @resurrect-dir)\n'
            'grep -v "^pane" "$dir/last" > "$dir/missing-pane"\n'
            'ln -sfn missing-pane "$dir/last"\n'
        )
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)
        self.assertEqual(self.tmux("show-option", "-gqv", "@resurrect-dir"),
                         str(self.directory))

    def test_publication_error_preserves_last_good_pair(self):
        self.save()
        previous = self.good_files()
        original = snapshot.atomic_link

        def fail_commit(path, target):
            if path.name == ".snapshot-current":
                raise OSError("deliberate publication failure")
            original(path, target)

        with patch.object(snapshot, "atomic_link", side_effect=fail_commit):
            self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)

    def test_zero_exit_with_broken_archive_is_rejected(self):
        self.save()
        previous = self.good_files()
        self.fake_saver(
            'bash "$SAVE_SCRIPT" quiet\n'
            'dir=$(tmux show-option -gqv @resurrect-dir)\n'
            'printf broken > "$dir/pane_contents.tar.gz"\n'
        )
        self.assertEqual(snapshot.main(self.args), 1)
        self.assertEqual(self.good_files(), previous)

    def test_stale_check_uses_success_stamp_not_layout_mtime(self):
        self.save()
        future = time.time() + 901
        with patch.object(snapshot.time, "time", return_value=future):
            self.assertEqual(snapshot.main(["--check", *self.args]), 1)
            self.assertEqual(snapshot.main(["--check", *self.args]), 1)
        self.assertEqual(len(self.alerts.read_text().splitlines()), 1)
        self.assertIn("Tmux backup stale", self.alerts.read_text())
        self.save()
        self.assertEqual(snapshot.main(["--check", *self.args]), 0)

    def test_missing_backup_alerts_after_startup_grace_period(self):
        self.assertEqual(snapshot.main(["--check", *self.args]), 0)
        self.assertFalse(self.alerts.exists())
        with patch.object(snapshot.time, "time",
                          return_value=time.time() + 901):
            self.assertEqual(snapshot.main(["--check", *self.args]), 1)
        self.assertIn("Tmux backup stale", self.alerts.read_text())

    def test_no_server_does_not_alert_or_create_a_server(self):
        self.stop_server()
        self.assertEqual(snapshot.main(["--check", *self.args]), 0)
        self.assertEqual(snapshot.main(self.args), 0)
        self.assertFalse(self.alerts.exists())


if __name__ == "__main__":
    unittest.main()
