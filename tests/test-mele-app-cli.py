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
                    "metricsTextfile": str(tmp / "mele_app_home.prom"),
                    "keepReleases": 5,
                    "metrics": {"enable": True, "path": "/metrics"},
                    "contract": {
                        "writeProbe": {
                            "enable": False,
                            "path": "/",
                            "method": "POST",
                            "contentType": "application/json",
                            "bodySize": "11MiB",
                        },
                    },
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
                subprocess_result("localhost/home:bad123\nlocalhost/home:current\n"),
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

    def test_image_cleanup_recreates_runtime_dir_after_service_failure(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            config = self.write_config(tmp, state)
            (state / "releases.jsonl").write_text(
                json.dumps({"release": "old1", "status": "deployed"}) + "\n"
            )
            completed = [
                subprocess_result("localhost/home:old1\nlocalhost/home:current\n"),
            ]
            with mock.patch.object(mele_app_cli, "ensure_runtime_dir") as ensure_runtime, \
                    mock.patch.object(mele_app_cli, "capture_command", side_effect=completed):
                removed = mele_app_cli.prune_release_images(
                    mele_app_cli.get_app(
                        mele_app_cli.load_config(config),
                        "home",
                    )
                )
            self.assertEqual(removed, [])
            ensure_runtime.assert_called()

    def test_successful_deploy_prunes_old_successful_release_images(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            state.mkdir()
            config_data = json.loads(self.write_config(tmp, state).read_text())
            config_data["apps"]["home"]["keepReleases"] = 2
            config = tmp / "config.json"
            config.write_text(json.dumps(config_data))
            releases = [
                {"release": "old1", "status": "deployed"},
                {"release": "old2", "status": "deployed"},
                {"release": "old3", "status": "deployed"},
            ]
            (state / "releases.jsonl").write_text(
                "".join(json.dumps(release) + "\n" for release in releases)
            )
            completed = [
                subprocess_result("Loaded image: localhost/source:latest\n"),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(
                    "localhost/home:old1\n"
                    "localhost/home:old2\n"
                    "localhost/home:old3\n"
                    "localhost/home:new4\n"
                    "localhost/home:current\n"
                    "localhost/other:old1\n"
                    "localhost/home:<none>\n"
                ),
                subprocess_result(""),
                subprocess_result(""),
            ]
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir"), \
                    mock.patch.object(mele_app_cli, "capture_command", side_effect=completed) as run, \
                    mock.patch.object(mele_app_cli, "poll_health", return_value=True):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "new4",
                ])
            self.assertEqual(exit_code, 0)
            removed = [call.args[0][-1] for call in run.call_args_list[5:]]
            self.assertEqual(len(removed), 2)
            self.assertIn("podman rmi localhost/home:old1", removed[0])
            self.assertIn("podman rmi localhost/home:old2", removed[1])

    def test_contract_check_requires_health_and_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            config = self.write_config(tmp)
            responses = [
                (200, "ok", "application/json"),
                (200, "# HELP app_requests_total Requests\napp_requests_total 1\n", "text/plain"),
            ]
            with mock.patch.object(
                mele_app_cli,
                "http_request",
                side_effect=responses,
            ):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "contract-check",
                    "home",
                ])
            self.assertEqual(exit_code, 0)

    def test_contract_check_fails_when_metrics_are_not_prometheus_text(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            config = self.write_config(tmp)
            responses = [
                (200, "ok", "application/json"),
                (200, "{\"not\": \"prometheus\"}", "application/json"),
            ]
            with mock.patch.object(
                mele_app_cli,
                "http_request",
                side_effect=responses,
            ):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "contract-check",
                    "home",
                ])
            self.assertEqual(exit_code, 1)

    def test_contract_check_write_probe_rejects_2xx_oversized_payload(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            config_data = json.loads(self.write_config(tmp).read_text())
            config_data["apps"]["home"]["contract"]["writeProbe"]["enable"] = True
            config = tmp / "config.json"
            config.write_text(json.dumps(config_data))
            responses = [
                (200, "ok", "application/json"),
                (200, "# TYPE app_requests_total counter\napp_requests_total 1\n", "text/plain"),
                (200, "accepted", "text/plain"),
            ]
            with mock.patch.object(
                mele_app_cli,
                "http_request",
                side_effect=responses,
            ):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "contract-check",
                    "home",
                ])
            self.assertEqual(exit_code, 1)

    def test_health_updates_textfile_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            config = self.write_config(tmp)
            with mock.patch.object(
                mele_app_cli,
                "health_status_once",
                return_value=(True, 200, None),
            ):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "health",
                    "home",
                ])
            self.assertEqual(exit_code, 0)
            metrics = (tmp / "mele_app_home.prom").read_text()
            self.assertIn('mele_app_last_health_status{app="home"} 1', metrics)
            self.assertIn('mele_app_last_health_timestamp_seconds{app="home"}', metrics)

    def test_deploy_writes_current_release_and_deploy_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            state = tmp / "state"
            config = self.write_config(tmp, state)
            completed = [
                subprocess_result("Loaded image: localhost/source:latest\n"),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result(""),
                subprocess_result("localhost/home:abc1234\nlocalhost/home:current\n"),
            ]
            with mock.patch.object(mele_app_cli.os, "geteuid", return_value=0), \
                    mock.patch.object(mele_app_cli, "ensure_runtime_dir"), \
                    mock.patch.object(mele_app_cli, "capture_command", side_effect=completed), \
                    mock.patch.object(mele_app_cli, "poll_health", return_value=True):
                exit_code = mele_app_cli.main([
                    "--config",
                    str(config),
                    "deploy",
                    "home",
                    "--release",
                    "abc1234",
                ])
            self.assertEqual(exit_code, 0)
            metrics = (tmp / "mele_app_home.prom").read_text()
            self.assertIn(
                'mele_app_current_release_info{app="home",release="abc1234"} 1',
                metrics,
            )
            self.assertIn(
                'mele_app_last_deploy_timestamp_seconds{app="home",'
                'status="deployed",release="abc1234"}',
                metrics,
            )
            self.assertIn('mele_app_last_health_status{app="home"} 1', metrics)

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
                subprocess_result("localhost/home:abc1234\nlocalhost/home:current\n"),
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
            ensure_runtime.assert_called()
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
