#!/usr/bin/env python3
"""Tests for the MeLE app host CLI."""

from __future__ import annotations

import importlib.util
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


class MeleAppCliTests(unittest.TestCase):
    def write_config(self, tmp: Path) -> Path:
        config = {
            "apps": {
                "home": {
                    "name": "home",
                    "hostPort": 8101,
                    "healthPath": "/health",
                    "serviceName": "mele-app-home.service",
                    "stateDir": str(tmp / "state"),
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


if __name__ == "__main__":
    unittest.main()
