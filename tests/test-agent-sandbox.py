"""Exercise the restricted pilot in a disposable linked Git worktree."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


PROBE_ENV = "PI_SANDBOX_PROBE"


def inside_probe():
    workspace, sentinel = map(Path, sys.argv[2:4])
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
    for operation in (
        lambda: sentinel.read_text(),
        lambda: sentinel.write_text("changed"),
        lambda: (workspace / "escape").read_text(),
        lambda: (Path.home() / ".pi/agent").iterdir().__next__(),
    ):
        try:
            operation()
        except (PermissionError, FileNotFoundError):
            pass
        else:
            raise AssertionError("A protected host path was accessible")
    try:
        with socket.socket(socket.AF_UNIX) as client:
            client.connect("/nix/var/nix/daemon-socket/socket")
    except (PermissionError, FileNotFoundError):
        pass
    else:
        raise AssertionError("Nix daemon socket was accessible")
    print(json.dumps({"edited": True, "tests": "passed", "boundary": "passed"}))


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
            environment = {**os.environ, "HOST_ONLY_SENTINEL": "not a secret"}
            result = subprocess.run(
                [probe, str(workspace), str(sentinel)], cwd=workspace,
                env=environment, text=True, capture_output=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('"boundary": "passed"', result.stdout)
            self.assertIn("return 42", (workspace / "example.py").read_text())
            self.assertEqual(sentinel.read_text(), "host sentinel")
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
