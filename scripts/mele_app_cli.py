#!/usr/bin/env python3
"""Operate MeLE app slots declared by the NixOS host config."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pwd
import re
import shlex
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, Sequence

DEFAULT_CONFIG = Path("/etc/mele-apps/config.json")
LOADED_IMAGE_RE = re.compile(r"Loaded image(?:s)?:\s*(?P<image>\S+)")
ENV_KEY_RE = re.compile(r"(?:export\s+)?(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*=")
APP_IMAGE_RE = re.compile(r"^localhost/(?P<app>[A-Za-z0-9_.-]+):(?P<tag>[^:]+)$")


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


def app_runtime_dir(app: dict[str, Any]) -> Path:
    return Path("/run") / f"mele-app-{app['name']}"


def ensure_runtime_dir(app: dict[str, Any]) -> None:
    runtime_dir = app_runtime_dir(app)
    runtime_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    user = pwd.getpwnam(app["user"])
    os.chown(runtime_dir, user.pw_uid, user.pw_gid)


def app_command(app: dict[str, Any], command: Sequence[str]) -> list[str]:
    quoted = " ".join(shlex.quote(part) for part in command)
    runtime_dir = shlex.quote(str(app_runtime_dir(app)))
    workdir = shlex.quote(f"/srv/apps/{app['name']}")
    script = (
        f"cd {workdir} && "
        "exec env "
        "PATH=/run/wrappers/bin:/run/current-system/sw/bin "
        f"XDG_RUNTIME_DIR={runtime_dir} "
        f"{quoted}"
    )
    return ["runuser", app["user"], "-s", "/bin/sh", "-c", script]


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


def secretspec_path(app: dict[str, Any]) -> Path:
    configured = app.get("secretspec", {}).get("path")
    return Path(configured or Path(app["stateDir"]) / "secretspec.toml")


def secretspec_profile(app: dict[str, Any]) -> str:
    return str(app.get("secretspec", {}).get("profile") or "prod")


def env_file_path(app: dict[str, Any]) -> Path:
    return Path(app.get("envFile") or f"/etc/mele-apps/{app['name']}.env")


def required_secretspec_keys(path: Path, profile: str) -> set[str]:
    if not path.exists():
        return set()
    try:
        data = tomllib.loads(path.read_text())
    except tomllib.TOMLDecodeError as exc:
        raise CliError(f"invalid SecretSpec TOML {path}: {exc}") from exc
    profiles = data.get("profiles", {})
    if not isinstance(profiles, dict):
        raise CliError(f"invalid SecretSpec {path}: profiles must be a table")
    if profile not in profiles:
        raise CliError(f"SecretSpec {path} does not contain profile {profile!r}")
    raw_profile = profiles[profile]
    if not isinstance(raw_profile, dict):
        raise CliError(
            f"invalid SecretSpec {path}: profiles.{profile} must be a table"
        )
    required: set[str] = set()
    for key, value in raw_profile.items():
        if isinstance(value, dict) and value.get("required") is False:
            continue
        required.add(key)
    return required


def env_file_keys(path: Path) -> set[str]:
    if not path.exists():
        return set()
    keys: set[str] = set()
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ENV_KEY_RE.match(line)
        if match:
            keys.add(match.group("key"))
    return keys


def validate_secret_contract(app: dict[str, Any]) -> None:
    required = required_secretspec_keys(secretspec_path(app), secretspec_profile(app))
    if not required:
        return
    env_path = env_file_path(app)
    present = env_file_keys(env_path)
    missing = sorted(required - present)
    if missing:
        raise CliError(
            f"{app['name']}: missing required secrets in {env_path}: "
            + ", ".join(missing)
        )


def current_release_path(app: dict[str, Any]) -> Path:
    return Path(app["stateDir"]) / "current"


def read_current_release(app: dict[str, Any]) -> str | None:
    path = current_release_path(app)
    if not path.exists():
        return None
    release = path.read_text().strip()
    return release or None


def health_url(app: dict[str, Any]) -> str | None:
    health_path = app.get("healthPath")
    if not health_path:
        return None
    return f"http://127.0.0.1:{app['hostPort']}{health_path}"


def health_status_once(app: dict[str, Any]) -> tuple[bool, int | None, str | None]:
    url = health_url(app)
    if url is None:
        return True, None, None
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return 200 <= response.status < 300, response.status, None
    except urllib.error.HTTPError as exc:
        return False, exc.code, None
    except urllib.error.URLError as exc:
        return False, None, str(exc.reason)


def health_check_once(app: dict[str, Any]) -> bool:
    healthy, _status, _error = health_status_once(app)
    return healthy


def metrics_textfile_path(app: dict[str, Any]) -> Path:
    configured = app.get("metricsTextfile")
    if configured:
        return Path(configured)
    return Path("/var/lib/node_exporter/textfile_collector") / f"mele_app_{app['name']}.prom"


def metric_labels(labels: dict[str, str]) -> str:
    escaped = {
        key: value.replace("\\", "\\\\").replace('"', '\\"')
        for key, value in labels.items()
    }
    return ",".join(f'{key}="{value}"' for key, value in escaped.items())


def render_metrics(app: dict[str, Any], updates: dict[str, Any]) -> str:
    lines = [
        "# HELP mele_app_current_release_info Current app release.",
        "# TYPE mele_app_current_release_info gauge",
    ]
    current = updates.get("current_release") or read_current_release(app)
    if current:
        labels = metric_labels({"app": app["name"], "release": str(current)})
        lines.append(f"mele_app_current_release_info{{{labels}}} 1")

    if "deploy" in updates:
        deploy = updates["deploy"]
        lines.extend([
            "# HELP mele_app_last_deploy_timestamp_seconds Last deploy event time.",
            "# TYPE mele_app_last_deploy_timestamp_seconds gauge",
        ])
        labels = metric_labels({
            "app": app["name"],
            "status": str(deploy["status"]),
            "release": str(deploy["release"]),
        })
        lines.append(
            f"mele_app_last_deploy_timestamp_seconds{{{labels}}} "
            f"{int(deploy['timestamp'])}"
        )

    if "health" in updates:
        health = updates["health"]
        labels = metric_labels({"app": app["name"]})
        lines.extend([
            "# HELP mele_app_last_health_status Last health status, 1=healthy.",
            "# TYPE mele_app_last_health_status gauge",
            f"mele_app_last_health_status{{{labels}}} "
            f"{1 if health['healthy'] else 0}",
            "# HELP mele_app_last_health_timestamp_seconds Last health check time.",
            "# TYPE mele_app_last_health_timestamp_seconds gauge",
            f"mele_app_last_health_timestamp_seconds{{{labels}}} "
            f"{int(health['timestamp'])}",
        ])

    if "rollback" in updates:
        rollback = updates["rollback"]
        labels = metric_labels({
            "app": app["name"],
            "status": str(rollback["status"]),
            "previous_release": str(rollback.get("previous_release") or ""),
        })
        lines.extend([
            "# HELP mele_app_last_rollback_info Last rollback outcome.",
            "# TYPE mele_app_last_rollback_info gauge",
            f"mele_app_last_rollback_info{{{labels}}} 1",
        ])

    return "\n".join(lines) + "\n"


def write_metrics(app: dict[str, Any], updates: dict[str, Any]) -> None:
    path = metrics_textfile_path(app)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path.write_text(render_metrics(app, updates))
        tmp_path.replace(path)
    except OSError as exc:
        print(f"{app['name']}: warning: metrics update failed: {exc}", file=sys.stderr)


def health_metrics(healthy: bool) -> dict[str, Any]:
    return {"healthy": healthy, "timestamp": int(dt.datetime.now(dt.UTC).timestamp())}


def poll_health(app: dict[str, Any], attempts: int = 12, delay: int = 5) -> bool:
    if health_url(app) is None:
        return True
    for attempt in range(attempts):
        if health_check_once(app):
            return True
        if attempt != attempts - 1:
            time.sleep(delay)
    return False


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
    url = health_url(app)
    if url is None:
        print(f"{app['name']}: no healthPath configured")
        write_metrics(app, {"health": health_metrics(True)})
        return 0
    healthy, status, error = health_status_once(app)
    write_metrics(app, {"health": health_metrics(healthy)})
    if error is not None:
        print(f"{app['name']}: health check failed {url}: {error}")
        return 1
    if status is not None and 200 <= status < 300:
        print(f"{app['name']}: healthy {status} {url}")
        return 0
    print(f"{app['name']}: unhealthy {status} {url}")
    return 1


def parse_size_bytes(value: str) -> int:
    units = {
        "b": 1,
        "kib": 1024,
        "mib": 1024 * 1024,
        "gib": 1024 * 1024 * 1024,
        "kb": 1000,
        "mb": 1000 * 1000,
        "gb": 1000 * 1000 * 1000,
    }
    match = re.fullmatch(r"\s*(\d+)\s*([A-Za-z]+)?\s*", value)
    if not match:
        raise CliError(f"invalid size: {value}")
    number = int(match.group(1))
    unit = (match.group(2) or "b").lower()
    if unit not in units:
        raise CliError(f"invalid size unit in {value}")
    return number * units[unit]


def http_request(
    url: str,
    method: str = "GET",
    body: bytes | None = None,
    content_type: str | None = None,
) -> tuple[int, str, str]:
    headers = {}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return (
                response.status,
                response.read(1024 * 1024).decode(errors="replace"),
                response.headers.get("Content-Type", ""),
            )
    except urllib.error.HTTPError as exc:
        return (
            exc.code,
            exc.read(1024 * 1024).decode(errors="replace"),
            exc.headers.get("Content-Type", ""),
        )
    except urllib.error.URLError as exc:
        raise CliError(f"request failed for {url}: {exc.reason}") from exc


def looks_like_prometheus_text(body: str) -> bool:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# HELP ") or stripped.startswith("# TYPE "):
            return True
        if re.match(r"^[A-Za-z_:][A-Za-z0-9_:]*(\{[^}]*\})?\s+[-+0-9.eE]+$", stripped):
            return True
    return False


def suspicious_metric_labels(body: str) -> list[str]:
    suspicious = {"user", "email", "token", "player", "sync_space"}
    found: set[str] = set()
    for labels in re.findall(r"\{([^}]*)\}", body):
        for label in re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*=", labels):
            if label.lower() in suspicious:
                found.add(label)
    return sorted(found)


def cmd_contract_check(app: dict[str, Any], _args: argparse.Namespace) -> int:
    failures: list[str] = []
    warnings: list[str] = []
    base_url = f"http://127.0.0.1:{app['hostPort']}"

    health_path = app.get("healthPath")
    if health_path:
        status, _body, _content_type = http_request(base_url + health_path)
        if not 200 <= status < 300:
            failures.append(f"health returned HTTP {status}")

    metrics = app.get("metrics", {})
    if metrics.get("enable"):
        status, body, _content_type = http_request(base_url + metrics.get("path", "/metrics"))
        if not 200 <= status < 300:
            failures.append(f"metrics returned HTTP {status}")
        elif not looks_like_prometheus_text(body):
            failures.append("metrics response does not look like Prometheus text")
        labels = suspicious_metric_labels(body)
        if labels:
            warnings.append("metrics expose suspicious labels: " + ", ".join(labels))

    probe = app.get("contract", {}).get("writeProbe", {})
    if probe.get("enable"):
        size = parse_size_bytes(str(probe.get("bodySize", "11MiB")))
        status, _body, _content_type = http_request(
            base_url + str(probe.get("path", "/")),
            method=str(probe.get("method", "POST")),
            body=b"x" * size,
            content_type=str(probe.get("contentType", "application/json")),
        )
        if 200 <= status < 300:
            failures.append(f"write probe accepted oversized payload: HTTP {status}")
        elif 500 <= status < 600:
            failures.append(f"write probe returned server error: HTTP {status}")
    else:
        warnings.append("write probe disabled; payload-limit behavior not verified")

    for warning in warnings:
        print(f"{app['name']}: warning: {warning}")
    if failures:
        for failure in failures:
            print(f"{app['name']}: contract failure: {failure}", file=sys.stderr)
        return 1
    print(f"{app['name']}: contract check passed")
    return 0


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


def cmd_update_secretspec(app: dict[str, Any], args: argparse.Namespace) -> int:
    require_root()
    if args.source != "-":
        raise CliError("update-secretspec currently reads from stdin; use '-'")
    content = sys.stdin.buffer.read()
    try:
        tomllib.loads(content.decode())
    except UnicodeDecodeError as exc:
        raise CliError("SecretSpec must be UTF-8 TOML") from exc
    except tomllib.TOMLDecodeError as exc:
        raise CliError(f"invalid SecretSpec TOML: {exc}") from exc
    destination = secretspec_path(app)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    print(f"{app['name']}: updated SecretSpec contract at {destination}")
    return 0


def restart_service(app: dict[str, Any]) -> None:
    restart = capture_command(["systemctl", "restart", app["serviceName"]])
    if restart.returncode != 0:
        raise CliError(
            f"failed to restart {app['serviceName']}: "
            f"{(restart.stdout + restart.stderr).strip()}"
        )


def tag_image(app: dict[str, Any], source: str, target: str) -> None:
    ensure_runtime_dir(app)
    tag = capture_command(app_command(app, ["podman", "tag", source, target]))
    if tag.returncode != 0:
        raise CliError(
            f"podman tag failed for {target}: "
            f"{(tag.stdout + tag.stderr).strip()}"
        )


def app_image_exists(app: dict[str, Any], image: str) -> bool:
    ensure_runtime_dir(app)
    exists = capture_command(app_command(app, ["podman", "image", "exists", image]))
    if exists.returncode == 0:
        return True
    output = exists.stdout + exists.stderr
    if "Failed to obtain podman configuration" in output:
        raise CliError(f"podman image exists failed for {image}: {output.strip()}")
    return False


def deploy_record(
    app: dict[str, Any],
    args: argparse.Namespace,
    release_image: str,
    status: str,
    previous_release: str | None = None,
    rollback_status: str | None = None,
) -> dict[str, Any]:
    record = {
        "app": app["name"],
        "release": args.release,
        "image": release_image,
        "repo": args.repo,
        "branch": args.branch,
        "dirty": args.dirty,
        "deployer": args.deployer or os.environ.get("SUDO_USER") or os.environ.get("USER"),
        "deployed_at": dt.datetime.now(dt.UTC).isoformat(),
        "status": status,
    }
    if previous_release is not None:
        record["previous_release"] = previous_release
    if rollback_status is not None:
        record["rollback_status"] = rollback_status
    return record


def release_log_path(app: dict[str, Any]) -> Path:
    return Path(app["stateDir"]) / "releases.jsonl"


def successful_release_ids(app: dict[str, Any]) -> list[str]:
    path = release_log_path(app)
    if not path.exists():
        return []
    releases: list[str] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("status") == "deployed" and record.get("release"):
            releases.append(str(record["release"]))
    return releases


def app_image_tags(app: dict[str, Any]) -> list[str]:
    ensure_runtime_dir(app)
    result = capture_command(app_command(
        app,
        [
            "podman",
            "images",
            "--format",
            "{{.Repository}}:{{.Tag}}",
            f"localhost/{app['name']}",
        ],
    ))
    if result.returncode != 0:
        raise CliError(
            f"podman images failed for {app['name']}: "
            f"{(result.stdout + result.stderr).strip()}"
        )
    tags: list[str] = []
    for raw_line in result.stdout.splitlines():
        image = raw_line.strip()
        match = APP_IMAGE_RE.match(image)
        if not match:
            continue
        if match.group("app") != app["name"]:
            continue
        tag = match.group("tag")
        if tag in ("current", "<none>"):
            continue
        tags.append(tag)
    return tags


def prune_release_images(
    app: dict[str, Any],
    extra_protected: set[str] | None = None,
) -> list[str]:
    keep_releases = int(app.get("keepReleases") or 5)
    successful = successful_release_ids(app)
    protected = set(successful[-keep_releases:])
    current = read_current_release(app)
    if current:
        protected.add(current)
    if extra_protected:
        protected.update(extra_protected)

    removed: list[str] = []
    for tag in app_image_tags(app):
        if tag in protected:
            continue
        image = f"localhost/{app['name']}:{tag}"
        ensure_runtime_dir(app)
        result = capture_command(app_command(app, ["podman", "rmi", image]))
        if result.returncode != 0:
            raise CliError(
                f"podman rmi failed for {image}: "
                f"{(result.stdout + result.stderr).strip()}"
            )
        removed.append(image)
    return removed


def cleanup_release_images(app: dict[str, Any], extra_protected: set[str] | None = None) -> None:
    try:
        removed = prune_release_images(app, extra_protected)
    except CliError as exc:
        print(f"{app['name']}: warning: image cleanup failed: {exc}", file=sys.stderr)
        return
    if removed:
        print(f"{app['name']}: pruned {len(removed)} old release image(s)")


def deploy_metrics(release: str, status: str) -> dict[str, Any]:
    return {
        "release": release,
        "status": status,
        "timestamp": int(dt.datetime.now(dt.UTC).timestamp()),
    }


def rollback_after_failed_health(
    app: dict[str, Any],
    args: argparse.Namespace,
    release_image: str,
    previous_release: str | None,
) -> int:
    rollback_status = "none"
    if previous_release is not None:
        previous_image = f"localhost/{app['name']}:{previous_release}"
        current_image = f"localhost/{app['name']}:current"
        if app_image_exists(app, previous_image):
            tag_image(app, previous_image, current_image)
            restart_service(app)
            if poll_health(app):
                rollback_status = "succeeded"
                current_release_path(app).write_text(previous_release + "\n")
            else:
                rollback_status = "failed"
        else:
            rollback_status = "unavailable"

    record = deploy_record(
        app,
        args,
        release_image,
        "failed_health",
        previous_release,
        rollback_status,
    )
    append_jsonl(release_log_path(app), record)
    extra_protected = {args.release} if rollback_status != "succeeded" else None
    cleanup_release_images(app, extra_protected)
    write_metrics(app, {
        "current_release": read_current_release(app),
        "deploy": deploy_metrics(args.release, "failed_health"),
        "health": health_metrics(rollback_status == "succeeded"),
        "rollback": {
            "status": rollback_status,
            "previous_release": previous_release or "",
        },
    })
    print(
        f"{app['name']}: deploy {args.release} failed health check; "
        f"rollback {rollback_status}"
    )
    return 2


def cmd_deploy(app: dict[str, Any], args: argparse.Namespace) -> int:
    require_root()
    validate_secret_contract(app)
    ensure_runtime_dir(app)
    previous_release = read_current_release(app)
    load = capture_command(app_command(app, ["podman", "load"]), stdin=sys.stdin.buffer)
    load_output = load.stdout + load.stderr
    if load.returncode != 0:
        raise CliError(f"podman load failed for {app['name']}: {load_output.strip()}")
    loaded_image = args.loaded_image or parse_loaded_image(load_output)
    release_image = f"localhost/{app['name']}:{args.release}"
    current_image = f"localhost/{app['name']}:current"

    for target in (release_image, current_image):
        tag_image(app, loaded_image, target)

    restart_service(app)

    if not poll_health(app):
        return rollback_after_failed_health(app, args, release_image, previous_release)

    record = deploy_record(app, args, release_image, "deployed")
    append_jsonl(release_log_path(app), record)
    current_release_path(app).write_text(args.release + "\n")
    cleanup_release_images(app)
    write_metrics(app, {
        "current_release": args.release,
        "deploy": deploy_metrics(args.release, "deployed"),
        "health": health_metrics(True),
    })
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

    for command in ("status", "health", "releases", "contract-check"):
        sub = subparsers.add_parser(command)
        sub.add_argument("app")

    update_secretspec = subparsers.add_parser("update-secretspec")
    update_secretspec.add_argument("app")
    update_secretspec.add_argument(
        "source",
        nargs="?",
        default="-",
        help="SecretSpec TOML source; only '-' is supported",
    )

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
    if args.command == "contract-check":
        return cmd_contract_check(app, args)
    if args.command == "update-secretspec":
        return cmd_update_secretspec(app, args)
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
