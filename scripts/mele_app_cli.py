#!/usr/bin/env python3
"""Operate MeLE app slots declared by the NixOS host config."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, Sequence

DEFAULT_CONFIG = Path("/etc/mele-apps/config.json")
LOADED_IMAGE_RE = re.compile(r"Loaded image(?:s)?:\s*(?P<image>\S+)")


class CliError(Exception):
    """User-facing CLI error."""


def load_config(path: Path) -> dict[str, Any]:
    try:
        with path.open() as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise CliError(f"config not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CliError(f"invalid JSON config {path}: {exc}") from exc
    if not isinstance(data.get("apps"), dict):
        raise CliError(f"config {path} does not contain an apps object")
    return data


def get_app(config: dict[str, Any], name: str) -> dict[str, Any]:
    apps = config["apps"]
    if name not in apps:
        known = ", ".join(sorted(apps)) or "none"
        raise CliError(f"unknown app {name!r}; known apps: {known}")
    app = apps[name]
    if not isinstance(app, dict):
        raise CliError(f"invalid app config for {name!r}")
    return app


def run_command(command: Sequence[str]) -> int:
    return subprocess.run(list(command), check=False).returncode


def capture_command(
    command: Sequence[str],
    stdin: BinaryIO | None = None,
) -> subprocess.CompletedProcess[str]:
    if stdin is None:
        return subprocess.run(
            list(command),
            text=True,
            capture_output=True,
            check=False,
        )
    result = subprocess.run(
        list(command),
        stdin=stdin,
        text=False,
        capture_output=True,
        check=False,
    )
    return subprocess.CompletedProcess(
        result.args,
        result.returncode,
        result.stdout.decode(errors="replace"),
        result.stderr.decode(errors="replace"),
    )


def app_command(app: dict[str, Any], command: Sequence[str]) -> list[str]:
    return ["runuser", "-u", app["user"], "--", *command]


def require_root() -> None:
    if os.geteuid() != 0:
        raise CliError("deploy must run as root, e.g. sudo mele-app deploy ...")


def parse_loaded_image(output: str) -> str:
    matches = list(LOADED_IMAGE_RE.finditer(output))
    if not matches:
        raise CliError(
            "could not determine loaded image from podman load output: "
            f"{output.strip()}"
        )
    return matches[-1].group("image")


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def cmd_status(app: dict[str, Any], _args: argparse.Namespace) -> int:
    return run_command([
        "systemctl",
        "status",
        app["serviceName"],
        "--no-pager",
        "-l",
    ])


def cmd_logs(app: dict[str, Any], args: argparse.Namespace) -> int:
    command = ["journalctl", "-u", app["serviceName"], "--no-pager"]
    if args.lines is not None:
        command.extend(["-n", str(args.lines)])
    if args.follow:
        command.append("-f")
    return run_command(command)


def cmd_health(app: dict[str, Any], _args: argparse.Namespace) -> int:
    health_path = app.get("healthPath")
    if not health_path:
        print(f"{app['name']}: no healthPath configured")
        return 0
    url = f"http://127.0.0.1:{app['hostPort']}{health_path}"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        print(f"{app['name']}: unhealthy {exc.code} {url}")
        return 1
    except urllib.error.URLError as exc:
        print(f"{app['name']}: health check failed {url}: {exc.reason}")
        return 1
    if 200 <= status < 300:
        print(f"{app['name']}: healthy {status} {url}")
        return 0
    print(f"{app['name']}: unhealthy {status} {url}")
    return 1


def cmd_releases(app: dict[str, Any], _args: argparse.Namespace) -> int:
    releases = Path(app["stateDir"]) / "releases.jsonl"
    try:
        if not releases.exists():
            print(f"{app['name']}: no releases recorded")
            return 0
        sys.stdout.write(releases.read_text())
    except PermissionError as exc:
        raise CliError(f"cannot read releases for {app['name']}: {exc}") from exc
    return 0


def cmd_deploy(app: dict[str, Any], args: argparse.Namespace) -> int:
    require_root()
    load = capture_command(app_command(app, ["podman", "load"]), stdin=sys.stdin.buffer)
    load_output = load.stdout + load.stderr
    if load.returncode != 0:
        raise CliError(f"podman load failed for {app['name']}: {load_output.strip()}")
    loaded_image = args.loaded_image or parse_loaded_image(load_output)
    release_image = f"localhost/{app['name']}:{args.release}"
    current_image = f"localhost/{app['name']}:current"

    for target in (release_image, current_image):
        tag = capture_command(app_command(app, ["podman", "tag", loaded_image, target]))
        if tag.returncode != 0:
            raise CliError(
                f"podman tag failed for {target}: "
                f"{(tag.stdout + tag.stderr).strip()}"
            )

    restart = capture_command(["systemctl", "restart", app["serviceName"]])
    if restart.returncode != 0:
        raise CliError(
            f"failed to restart {app['serviceName']}: "
            f"{(restart.stdout + restart.stderr).strip()}"
        )

    record = {
        "app": app["name"],
        "release": args.release,
        "image": release_image,
        "repo": args.repo,
        "branch": args.branch,
        "dirty": args.dirty,
        "deployer": args.deployer or os.environ.get("SUDO_USER") or os.environ.get("USER"),
        "deployed_at": dt.datetime.now(dt.UTC).isoformat(),
        "status": "deployed",
    }
    append_jsonl(Path(app["stateDir"]) / "releases.jsonl", record)
    (Path(app["stateDir"]) / "current").write_text(args.release + "\n")
    print(f"{app['name']}: deployed {args.release}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Operate MeLE app slots")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"Config JSON path, default: {DEFAULT_CONFIG}",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command in ("status", "health", "releases"):
        sub = subparsers.add_parser(command)
        sub.add_argument("app")

    deploy = subparsers.add_parser("deploy")
    deploy.add_argument("app")
    deploy.add_argument("--release", required=True)
    deploy.add_argument("--loaded-image", help="Image reference reported by podman load")
    deploy.add_argument("--repo")
    deploy.add_argument("--branch")
    deploy.add_argument("--dirty", choices=("true", "false"))
    deploy.add_argument("--deployer")
    deploy.add_argument(
        "archive",
        nargs="?",
        default="-",
        help="OCI/docker archive; only '-' is supported",
    )

    logs = subparsers.add_parser("logs")
    logs.add_argument("app")
    logs.add_argument("--follow", "-f", action="store_true")
    logs.add_argument("--lines", "-n", type=int)
    return parser


def dispatch(app: dict[str, Any], args: argparse.Namespace) -> int:
    if args.command == "status":
        return cmd_status(app, args)
    if args.command == "logs":
        return cmd_logs(app, args)
    if args.command == "health":
        return cmd_health(app, args)
    if args.command == "releases":
        return cmd_releases(app, args)
    if args.command == "deploy":
        if args.archive != "-":
            raise CliError("deploy currently reads image archives from stdin; use '-'")
        return cmd_deploy(app, args)
    raise CliError(f"unimplemented command: {args.command}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        app = get_app(config, args.app)
        return dispatch(app, args)
    except CliError as exc:
        print(f"mele-app: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
