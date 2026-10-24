"""Exercise the restricted pilot in a disposable linked Git worktree."""

from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


PROBE_ENV = "PI_SANDBOX_PROBE"
PROBE_NAMES = (
    "outside_read", "outside_write", "symlink_read", "symlink_write",
    "normal_pi_state_list", "nix_daemon_connect",
)
DENIALS = {
    errno.EACCES: "permission_denied",
    errno.EPERM: "permission_denied",
    errno.ENOENT: "not_visible",
}


def validate_evidence(records):
    indexed = {(r["phase"], r["operation"]): r for r in records}
    assert len(indexed) == len(records), "Duplicate observations"
    for operation in PROBE_NAMES:
        for phase in ("host_before", "inside", "host_after"):
            assert (phase, operation) in indexed, f"Missing {phase}: {operation}"
        before = indexed["host_before", operation]
        inside = indexed["inside", operation]
        after = indexed["host_after", operation]
        assert before["outcome"] == "allowed", f"Host before failed: {operation}"
        assert after["outcome"] == "allowed", f"Host after failed: {operation}"
        assert Path(before["path"]).is_absolute(), "Not an absolute host path"
        assert before["path"] == inside["path"] == after["path"], (
            f"Host/sandbox path mismatch: {operation}"
        )
        expected = DENIALS.get(inside["errno"])
        assert expected is not None and inside["outcome"] == expected, (
            f"Not denial evidence: {operation}: {inside}"
        )


def connect_socket(path):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(2)
        client.connect(str(path))


def observe_access(paths, phase):
    sentinel = Path(paths["sentinel"])
    escape = Path(paths["escape"])
    normal_pi = Path(paths["normal_pi"])
    daemon = Path(paths["daemon"])
    # Directory names and credential contents never enter the evidence report.
    operations = (
        (sentinel, lambda: sentinel.read_text()),
        (sentinel, lambda: sentinel.write_text("host sentinel")),
        (escape, lambda: escape.read_text()),
        (escape, lambda: escape.write_text("host sentinel")),
        (normal_pi, lambda: os.listdir(normal_pi)),
        (daemon, lambda: connect_socket(daemon)),
    )
    records = []
    for name, (path, operation) in zip(PROBE_NAMES, operations, strict=True):
        record = {
            "phase": phase, "operation": name, "path": str(path),
            "processHome": str(Path.home()), "outcome": "allowed",
            "errno": None, "errnoName": None,
        }
        try:
            operation()
        except OSError as error:
            record.update(
                outcome=DENIALS.get(error.errno, "error"),
                errno=error.errno,
                errnoName=errno.errorcode.get(error.errno),
            )
        records.append(record)
    return records


def save_evidence(report):
    directory = (
        Path(__file__).resolve().parents[1] / ".devenv/state/sandbox-evidence"
    )
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    path = directory / f"{stamp}-{os.getpid()}.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(report, stream, indent=2)
        stream.write("\n")
    for record in report["observations"]:
        print(f'{record["phase"]}: {record["operation"]}: '
              f'{record["outcome"]} errno={record["errnoName"]}')
    print(f"Evidence: {path}", flush=True)


def inside_probe():
    workspace = Path(sys.argv[2])
    paths = json.loads(sys.argv[3])
    assert Path.cwd().resolve() == workspace.resolve()
    edited = workspace / "example.py"
    edited.write_text("def answer():\n    return 42\n")
    subprocess.run(
        [sys.executable, "-m", "unittest", "test_example.py"], check=True,
    )
    assert subprocess.check_output(
        ["git", "config", "--get", "commit.gpgsign"], text=True,
    ).strip() == "true"
    before = subprocess.check_output(["git", "rev-parse", "HEAD"])
    commit = subprocess.run(
        ["git", "-c", "user.name=Sandbox test",
         "-c", "user.email=sandbox@example.invalid", "commit", "--allow-empty",
         "-m", "Signing must remain outside"],
        capture_output=True, timeout=15,
    )
    assert commit.returncode != 0, "Commit unexpectedly signed in sandbox"
    assert subprocess.check_output(["git", "rev-parse", "HEAD"]) == before
    assert "HOST_ONLY_SENTINEL" not in os.environ
    for record in observe_access(paths, "inside"):
        print(json.dumps(record), flush=True)


class EvidenceTests(unittest.TestCase):
    def records(self):
        return [
            {"phase": phase, "operation": operation,
             "path": f"/original-host/{operation}",
             "outcome": "permission_denied" if phase == "inside" else "allowed",
             "errno": 13 if phase == "inside" else None}
            for phase in ("host_before", "inside", "host_after")
            for operation in PROBE_NAMES
        ]

    def test_requires_host_positive_controls(self):
        records = [r for r in self.records() if r["phase"] == "inside"]
        with self.assertRaisesRegex(AssertionError, "host_before"):
            validate_evidence(records)

    def test_rejects_synthetic_home_instead_of_original_host_path(self):
        records = self.records()
        for record in records:
            if record["phase"] == "inside":
                record["path"] = "/synthetic-home/.pi/agent"
        with self.assertRaisesRegex(AssertionError, "path"):
            validate_evidence(records)

    def test_unexpected_socket_errors_are_not_denial_evidence(self):
        records = self.records()
        for record in records:
            if record["phase"] == "inside":
                record.update(outcome="error", errno=61)
        with self.assertRaisesRegex(AssertionError, "denial"):
            validate_evidence(records)

    def test_accepts_matching_controls_and_specific_denials(self):
        validate_evidence(self.records())


@unittest.skipUnless(sys.platform == "darwin", "macOS pilot")
class SandboxTests(unittest.TestCase):
    def test_launch_refuses_a_primary_checkout(self):
        command = os.environ.get("PI_SANDBOX_COMMAND")
        self.assertIsNotNone(command, "Enter the agent-sandbox devenv profile")
        with tempfile.TemporaryDirectory(prefix="pi-sandbox-primary-") as root:
            subprocess.run(["git", "init", "-q", root], check=True)
            result = subprocess.run(
                [command, "--version"], cwd=root, text=True,
                capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 64, result.stderr)
            self.assertIn("prepared linked worktree", result.stderr)

    def test_edits_and_tests_work_but_host_access_is_denied(self):
        probe = os.environ.get(PROBE_ENV)
        self.assertIsNotNone(probe, "Enter the agent-sandbox devenv profile")
        with tempfile.TemporaryDirectory(
            prefix=".pi-sandbox-test-", dir=Path.home(),
        ) as temporary:
            root = Path(temporary)
            primary = root / "primary"
            workspace = root / "worktree"
            sentinel = root / "outside.txt"
            primary.mkdir()
            sentinel.write_text("host sentinel")
            subprocess.run(["git", "init", "-q", str(primary)], check=True)
            tree = subprocess.check_output(
                ["git", "-C", str(primary), "mktree"], input=b"",
            ).decode().strip()
            # Construct fixture history without invoking real signing keys.
            identity = "Sandbox test <sandbox@example.invalid> 0 +0000"
            commit = subprocess.check_output(
                ["git", "-C", str(primary), "hash-object", "-t", "commit",
                 "-w", "--stdin"],
                input=(f"tree {tree}\nauthor {identity}\n"
                       f"committer {identity}\n\nDisposable fixture\n").encode(),
            ).decode().strip()
            subprocess.run(
                ["git", "-C", str(primary), "worktree", "add", "--detach",
                 str(workspace), commit], check=True, capture_output=True,
            )
            (workspace / "escape").symlink_to(sentinel)
            (workspace / "test_example.py").write_text(
                "import unittest\nfrom example import answer\n\n"
                "class Example(unittest.TestCase):\n"
                "    def test_answer(self):\n"
                "        self.assertEqual(answer(), 42)\n",
            )
            # Resolve original host paths BEFORE HOME is changed by the sandbox.
            # Do not resolve escape: the symlink itself is part of the probe.
            paths = {
                "sentinel": str(sentinel.resolve()),
                "escape": str(workspace / "escape"),
                "normal_pi": str((Path.home() / ".pi/agent").resolve()),
                "daemon": "/nix/var/nix/daemon-socket/socket",
            }
            report = {
                "schemaVersion": 1, "boundaryStatus": "failed",
                "scope": "Real sandbox payload, not a model-driven Pi turn",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "probeExecutable": probe,
                "testSourceSha256": hashlib.sha256(
                    Path(__file__).read_bytes(),
                ).hexdigest(),
                "hostPaths": paths, "observations": [],
            }
            records = report["observations"]
            try:
                records.extend(observe_access(paths, "host_before"))
                for record in records:
                    self.assertEqual(record["outcome"], "allowed", record)
                environment = {**os.environ, "HOST_ONLY_SENTINEL": "not a secret"}
                result = subprocess.run(
                    [probe, str(workspace), json.dumps(paths)], cwd=workspace,
                    env=environment, text=True, capture_output=True, timeout=60,
                )
                report["probeExitCode"] = result.returncode
                records.extend(
                    json.loads(line) for line in result.stdout.splitlines()
                )
                self.assertEqual(sentinel.read_text(), "host sentinel")
                records.extend(observe_access(paths, "host_after"))
                self.assertEqual(
                    result.returncode, 0, result.stdout + result.stderr,
                )
                validate_evidence(records)
                self.assertIn("return 42", (workspace / "example.py").read_text())
                report["boundaryStatus"] = "passed"
            finally:
                save_evidence(report)
            command = os.environ["PI_SANDBOX_COMMAND"]
            version = subprocess.run(
                [command, "--version"], cwd=workspace, text=True,
                capture_output=True, timeout=30,
            )
            self.assertEqual(version.returncode, 0, version.stderr)
            self.assertRegex(version.stdout.strip(), r"^\d+\.\d+\.\d+")
            auth = subprocess.run(
                [command, "auth", "check", "--provider", "openai-codex",
                 "--json", "--no-refresh"], cwd=workspace, text=True,
                capture_output=True, timeout=30,
            )
            self.assertIn(auth.returncode, (0, 1, 2), auth.stderr)
            self.assertIn(json.loads(auth.stdout)["status"],
                          ("ready", "not_ready", "invalid"))
            management = subprocess.run(
                [command, "update"], cwd=workspace, text=True,
                capture_output=True, timeout=30,
            )
            self.assertEqual(management.returncode, 64, management.stderr)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--inside":
        inside_probe()
    else:
        unittest.main()
