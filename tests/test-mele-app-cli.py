#!/usr/bin/env python3
"""Tests for the MeLE app host CLI."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
CLI_PATH = ROOT / "scripts" / "mele_app_cli.py"

spec = importlib.util.spec_from_file_location("mele_app_cli", CLI_PATH)
assert spec and spec.loader
mele_app_cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mele_app_cli)


def subprocess_result(output: str, returncode: int = 0):
    return mele_app_cli.subprocess.CompletedProcess(
        [],
        returncode,
        output,
        "",
    )


class MeleAppCliTests(unittest.TestCase):
    def write_config(self, tmp: Path, state_dir: Path | None = None) -> Path:
        config = {
            "apps": {
                "home": {
                    "name": "home",
                    "hostPort": 8101,
                    "healthPath": "/health",
                    "serviceName": "mele-app-home.service",
                    "stateDir": str(state_dir or (tmp / "state")),
                    "envFile": str(tmp / "home.env"),
                    "secretspec": {
                        "profile": "prod",
                        "path": str((state_dir or (tmp / "state")) / "secretspec.toml"),
                    },
                    "user": "app-home",
                }
            }
        }
        path = tmp / "config.json"
        path.write_text(json.dumps(config))
        return path

    def test_unknown_app_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            config = self.write_config(Path(raw_tmp))
            exit_code = mele_app_cli.main(["--config", str(config), "status", "missing"])
        self.assertEqual(exit_code, 2)

    def test_status_runs_systemctl_for_declared_service(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            config = self.write_config(Path(raw_tmp))
            with mock.patch.object(mele_app_cli, "run_command", return_value=0) as run:
                exit_code = mele_app_cli.main(["--config", str(config), "status", "home"])
        self.assertEqual(exit_code, 0)
        run.assert_called_once_with([
            "systemctl",
            "status",
            "mele-app-home.service",
            "--no-pager",
            "-l",
        ])

    def test_logs_runs_journalctl_for_declared_service(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            config = self.write_config(Path(raw_tmp))
            with mock.patch.object(mele_app_cli, "run_command", return_value=0) as run:
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "logs",
                    "home",
                    "--lines",
                    "20",
                ])
        self.assertEqual(exit_code, 0)
        run.assert_called_once_with([
            "journalctl",
            "-u",
            "mele-app-home.service",
            "--no-pager",
            "-n",
            "20",
        ])

    def test_releases_reports_empty_state(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            config = self.write_config(Path(raw_tmp))
            exit_code = mele_app_cli.main(["--config", str(config), "releases", "home"])
        self.assertEqual(exit_code, 0)

    def test_releases_reports_permission_error_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            config = self.write_config(tmp, state)
            with mock.patch("pathlib.Path.exists", side_effect=PermissionError("nope")):
                exit_code = mele_app_cli.main(["--config", str(config), "releases", "home"])
        self.assertEqual(exit_code, 2)

    def test_required_secretspec_keys_use_profile_and_required_flag(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            path = Path(raw_tmp) / "secretspec.toml"
            path.write_text(
                "[profiles.prod]\n"
                "API_KEY = { description = \"required by default\" }\n"
                "OPTIONAL_TOKEN = { required = false }\n"
                "[profiles.dev]\n"
                "DEV_ONLY = { description = \"ignored\" }\n"
            )
            self.assertEqual(
                mele_app_cli.required_secretspec_keys(path, "prod"),
                {"API_KEY"},
            )

    def test_env_file_keys_ignore_comments_and_export_prefixes(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            path = Path(raw_tmp) / "home.env"
            path.write_text(
                "# ignored\n"
                "export API_KEY=secret\n"
                "EMPTY=\n"
                "QUOTED='value with spaces'\n"
            )
            self.assertEqual(
                mele_app_cli.env_file_keys(path),
                {"API_KEY", "EMPTY", "QUOTED"},
            )

    def test_update_secretspec_requires_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            config = self.write_config(tmp, state)
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=1000):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "update-secretspec",
                    "home",
                    "-",
                ])
            self.assertEqual(exit_code, 2)
            self.assertFalse((state / "secretspec.toml").exists())

    def test_update_secretspec_stores_contract_in_app_state(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            config = self.write_config(tmp, state)
            payload = b"[profiles.prod]\nAPI_KEY = {}\n"
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli.sys, "stdin") as stdin:
                stdin.buffer = io.BytesIO(payload)
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "update-secretspec",
                    "home",
                    "-",
                ])
            self.assertEqual(exit_code, 0)
            self.assertEqual((state / "secretspec.toml").read_bytes(), payload)

    def test_deploy_fails_before_load_when_secretspec_profile_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            config = self.write_config(tmp, state)
            (state / "secretspec.toml").write_text(
                "[profiles.default]\n"
                "API_KEY = { description = \"required\" }\n"
            )
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir") as ensure_runtime, \
                    mock.patch.object(mele_app_cli, "capture_command") as run:
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "abc1234",
                ])
            self.assertEqual(exit_code, 2)
            ensure_runtime.assert_not_called()
            run.assert_not_called()

    def test_deploy_fails_before_load_when_required_secret_missing(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            config = self.write_config(tmp, state)
            (state / "secretspec.toml").write_text(
                "[profiles.prod]\n"
                "API_KEY = { description = \"required\" }\n"
                "OPTIONAL_TOKEN = { required = false }\n"
            )
            (tmp / "home.env").write_text("OPTIONAL_TOKEN=present\n")
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir") as ensure_runtime, \
                    mock.patch.object(mele_app_cli, "capture_command") as run:
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "abc1234",
                ])
            self.assertEqual(exit_code, 2)
            ensure_runtime.assert_not_called()
            run.assert_not_called()
            self.assertFalse((state / "current").exists())

    def test_deploy_rolls_back_to_previous_release_when_health_fails(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            (state / "current").write_text("prev123\n")
            config = self.write_config(tmp, state)
            completed = [
                subprocess_result("Loaded image: localhost/source:latest\n"),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
            ]
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir"), \
                    mock.patch.object(mele_app_cli, "capture_command", side_effect=completed) as run, \
                    mock.patch.object(mele_app_cli, "poll_health", side_effect=[False, True]):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "bad123",
                ])
            self.assertEqual(exit_code, 2)
            self.assertEqual(
                run.call_args_list[3].args[0],
                ["systemctl", "restart", "mele-app-home.service"],
            )
            self.assertIn(
                "podman image exists localhost/home:prev123",
                run.call_args_list[4].args[0][-1],
            )
            self.assertIn(
                "podman tag localhost/home:prev123 localhost/home:current",
                run.call_args_list[5].args[0][-1],
            )
            self.assertEqual(
                run.call_args_list[6].args[0],
                ["systemctl", "restart", "mele-app-home.service"],
            )
            self.assertEqual((state / "current").read_text(), "prev123\n")
            records = [
                json.loads(line)
                for line in (state / "releases.jsonl").read_text().splitlines()
            ]
            self.assertEqual(records[-1]["status"], "failed_health")
            self.assertEqual(records[-1]["previous_release"], "prev123")
            self.assertEqual(records[-1]["rollback_status"], "succeeded")

    def test_deploy_loads_tags_restarts_and_records_release(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            config = self.write_config(tmp, state)
            completed = [
                subprocess_result("Loaded image: localhost/source:latest\n"),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
            ]
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir") as ensure_runtime, \
                    mock.patch.object(mele_app_cli, "capture_command", side_effect=completed) as run, \
                    mock.patch.object(mele_app_cli, "poll_health", return_value=True):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "abc1234",
                    "--repo",
                    "git@example/home.git",
                    "--branch",
                    "main",
                    "--dirty",
                    "false",
                ])
            self.assertEqual(exit_code, 0)
            ensure_runtime.assert_called_once()
            self.assertEqual(run.call_args_list[0].args[0][:4], ["runuser", "app-home", "-s", "/bin/sh"])
            self.assertIn("podman load", run.call_args_list[0].args[0][-1])
            self.assertIn("XDG_RUNTIME_DIR=/run/mele-app-home", run.call_args_list[0].args[0][-1])
            self.assertIn("podman tag localhost/source:latest localhost/home:abc1234", run.call_args_list[1].args[0][-1])
            self.assertIn("podman tag localhost/source:latest localhost/home:current", run.call_args_list[2].args[0][-1])
            self.assertEqual(
                run.call_args_list[3].args[0],
                ["systemctl", "restart", "mele-app-home.service"],
            )
            self.assertEqual((state / "current").read_text(), "abc1234\n")
            release = json.loads((state / "releases.jsonl").read_text())
            self.assertEqual(release["release"], "abc1234")
            self.assertEqual(release["status"], "deployed")


if __name__ == "__main__":
    unittest.main()
