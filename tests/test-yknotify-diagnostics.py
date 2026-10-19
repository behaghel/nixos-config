"""Verify private, bounded diagnostics without real key operations."""

import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

HELPER = Path(os.environ.get(
    "YKNOTIFY_CONTEXT_HELPER",
    Path(__file__).resolve().parents[1] / "modules/home/darwin/yknotify/context.py",
))
spec = importlib.util.spec_from_file_location(
    "yknotify_diagnostics", HELPER.with_name("diagnostics.py")
)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = dict(os.environ, HOME=self.temp.name,
                        YKNOTIFY_DIAGNOSTICS="1")
        self.environment = patch.dict(os.environ, self.env)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.directory = Path(self.temp.name) / "Library/Logs/yknotify-diagnostics"

    def records(self):
        return [json.loads(line) for line in
                (self.directory / "events.jsonl").read_text().splitlines()]

    def test_disabled_does_not_create_logs_or_probe(self):
        with patch.dict(os.environ, YKNOTIFY_DIAGNOSTICS="0"):
            self.assertFalse(diag.emit("test"))
            output = io.StringIO()
            with patch.object(diag, "capture") as capture:
                diag.observe_stream(io.StringIO('{"type":"OpenPGP"}\n'),
                                    output, 10, lambda: [])
                capture.assert_not_called()
            self.assertEqual(output.getvalue(), '{"type":"OpenPGP"}\n')
        self.assertFalse(self.directory.exists())

    def test_wrapper_lifecycle_is_correlated_without_sensitive_data(self):
        result = subprocess.run(
            [sys.executable, str(HELPER), "wrap", sys.executable, "-c",
             "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read()); "
             "sys.exit(7)", "--detach-sign", "secret-key-id"],
            input=b"private signing data", capture_output=True, env=self.env,
        )
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, b"private signing data")
        records = self.records()
        self.assertEqual([r["event"] for r in records],
                         ["git_request_start", "git_request_end"])
        self.assertEqual(records[0]["request_id"], records[1]["request_id"])
        self.assertEqual(records[1]["exit_code"], 7)
        text = json.dumps(records)
        for secret in ("private signing data", "secret-key-id", self.temp.name,
                       "--detach-sign", "sys.stdout"):
            self.assertNotIn(secret, text)

    def test_rotation_and_permissions(self):
        with patch.object(diag, "MAX_BYTES", 512):
            for i in range(30):
                diag.emit("test", sequence=i)
        self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode), 0o700)
        for path in self.directory.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            if path.name.startswith("events.jsonl"):
                self.assertLessEqual(path.stat().st_size, 512)
                for line in path.read_text().splitlines():
                    json.loads(line)
        self.assertTrue((self.directory / "events.jsonl.1").exists())
        self.assertFalse((self.directory / "events.jsonl.2").exists())

    def test_concurrent_writers_keep_rotated_json_valid(self):
        code = (
            "import sys; sys.path.insert(0, sys.argv[1]); import diagnostics; "
            "diagnostics.MAX_BYTES = 1024; "
            "[diagnostics.emit('test', sequence=i) for i in range(100)]"
        )
        children = [subprocess.Popen(
            [sys.executable, "-B", "-c", code, str(HELPER.parent)], env=self.env
        ) for _ in range(3)]
        try:
            for child in children:
                self.assertEqual(child.wait(timeout=10), 0)
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
        records = []
        for path in self.directory.glob("events.jsonl*"):
            self.assertLessEqual(path.stat().st_size, 1024)
            records.extend(json.loads(line)
                           for line in path.read_text().splitlines())
        self.assertTrue(records)

    def test_unsafe_journal_does_not_follow_symlinks_or_break_signing(self):
        target = Path(self.temp.name) / "untouched"
        target.write_text("sentinel")
        self.directory.mkdir(parents=True, mode=0o700)
        (self.directory / "events.jsonl").symlink_to(target)
        self.assertFalse(diag.emit("test"))
        result = subprocess.run(
            [sys.executable, str(HELPER), "wrap", sys.executable, "-c",
             "print('signed')", "--detach-sign"],
            env=self.env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "signed\n")
        self.assertEqual(target.read_text(), "sentinel")

    def test_burst_sampling_is_per_type_and_bounds_long_bursts(self):
        sampler = diag.BurstSampler(10)
        self.assertEqual(sampler.observe("OpenPGP", 0), "burst_start")
        self.assertEqual(sampler.observe("FIDO2", 1), "burst_start")
        for now in range(1, 60):
            self.assertIsNone(sampler.observe("OpenPGP", now))
        self.assertEqual(sampler.observe("OpenPGP", 60), "periodic_sample")
        self.assertEqual(sampler.observe("OpenPGP", 71), "burst_start")
        self.assertIsNone(sampler.observe("untrusted event text", 72))

    def test_stream_samples_even_with_git_context_and_preserves_events(self):
        events = ('{"type":"OpenPGP"}\n' * 3
                  + '{"type":"FIDO2"}\n' + 'malformed input\n')
        output = io.StringIO()
        with patch.object(diag, "capture", return_value={"probe": "test"}):
            diag.observe_stream(io.StringIO(events), output, 10,
                                lambda: ["opaque-request-id"])
        self.assertEqual(output.getvalue(), events)
        records = self.records()
        self.assertEqual(len(records), 2)
        self.assertEqual({r["type"] for r in records}, {"OpenPGP", "FIDO2"})
        for record in records:
            self.assertEqual(record["pending_git_requests"], ["opaque-request-id"])
            self.assertEqual(record["attribution"], "unverified")

    def test_snapshot_uses_names_not_paths_and_marks_candidates(self):
        ps = ("10 1 /private/repo/git\n"
              "11 10 /nix/store/private/bin/gpg\n"
              "12 1 /Applications/Unrelated.app/Unrelated\n")
        lsof = ("p20\nf7u\ntunix\nD0x123\n"
                "n/Users/private/.gnupg/S.gpg-agent.ssh\n")
        with patch.object(diag, "probe", side_effect=[ps, lsof]):
            snapshot = diag.capture("OpenPGP")
        self.assertEqual({p["name"] for p in snapshot["processes"]},
                         {"git", "gpg"})
        self.assertTrue(all(p["evidence"] in ("candidate", "ancestor")
                            for p in snapshot["processes"]))
        self.assertEqual(snapshot["agent_socket_fds"][0]["socket"], "ssh")
        text = json.dumps(snapshot)
        for secret in ("/private", "/nix/store", "/Users", "Unrelated"):
            self.assertNotIn(secret, text)

    def test_slow_probes_do_not_delay_event_forwarding(self):
        started = threading.Event()
        release = threading.Event()

        def slow_capture(_kind):
            started.set()
            release.wait(timeout=3)
            return {}

        events = '{"type":"OpenPGP"}\n{"type":"FIDO2"}\n'
        output = io.StringIO()
        with patch.object(diag, "capture", side_effect=slow_capture):
            thread = threading.Thread(
                target=diag.observe_stream,
                args=(io.StringIO(events), output, 10, lambda: []),
            )
            thread.start()
            try:
                self.assertTrue(started.wait(timeout=1))
                # Allow the reader thread to run after the probe starts.
                for _ in range(100):
                    if output.getvalue() == events:
                        break
                    threading.Event().wait(0.005)
                self.assertEqual(output.getvalue(), events)
            finally:
                release.set()
                thread.join(timeout=4)
            self.assertFalse(thread.is_alive())

    def test_worker_start_failure_preserves_stream(self):
        events = '{"type":"OpenPGP"}\n{"type":"FIDO2"}\n'
        output = io.StringIO()
        with patch.object(diag.threading.Thread, "start",
                          side_effect=RuntimeError("unavailable")):
            diag.observe_stream(io.StringIO(events), output, 10, lambda: [])
        self.assertEqual(output.getvalue(), events)

    def test_probe_failure_and_capture_failure_preserve_stream(self):
        with patch.object(diag, "probe", return_value=None):
            snapshot = diag.capture("OpenPGP")
        self.assertEqual(snapshot["process_probe"], "unavailable")
        self.assertEqual(snapshot["socket_probe"], "unavailable")
        output = io.StringIO()
        with patch.object(diag, "capture", side_effect=OSError("private path")):
            diag.observe_stream(io.StringIO('{"type":"OpenPGP"}\n'),
                                output, 10, lambda: None)
        self.assertEqual(output.getvalue(), '{"type":"OpenPGP"}\n')
        self.assertNotIn("private path", json.dumps(self.records()))


if __name__ == "__main__":
    unittest.main()
