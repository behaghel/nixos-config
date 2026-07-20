#!/usr/bin/env python3
"""Project helper for Hugo static sites deployed to MeLE."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import time
import tomllib
import webbrowser
from pathlib import Path
from typing import Any, Mapping, Sequence


def run(command: Sequence[str], env: Mapping[str, str] | None = None) -> None:
    subprocess.run(list(command), check=True, env=dict(env) if env else None)


def run_status(command: Sequence[str], quiet: bool = False) -> int:
    kwargs: dict[str, Any] = {"check": False}
    if quiet:
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    return subprocess.run(list(command), **kwargs).returncode


def capture(command: Sequence[str]) -> str:
    return subprocess.run(
        list(command),
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def load_config() -> dict[str, Any]:
    with Path("hugo.toml").open("rb") as handle:
        return tomllib.load(handle)


def mele_config() -> dict[str, str]:
    data = load_config()
    params = data.get("params", {})
    mele = params.get("mele", {}) if isinstance(params, dict) else {}
    site = str(mele.get("site") or "example")
    base_url = str(data.get("baseURL") or f"https://{site}.home.behaghel.org/")
    return {
        "site": site,
        "host": str(mele.get("host") or "hub@mele"),
        "root": str(mele.get("root") or f"/srv/static/{site}"),
        "url": base_url,
    }


def release_id() -> str:
    timestamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    try:
        rev = capture(["git", "rev-parse", "--short", "HEAD"])
    except subprocess.CalledProcessError:
        rev = "nogit"
    return f"{timestamp}-{rev}"


def ensure_public() -> None:
    if not Path("public").is_dir():
        raise SystemExit("public/ missing after build")


def copy_public_to_release(release_dir: Path) -> None:
    if release_dir.exists():
        raise SystemExit(f"release already exists: {release_dir}")
    shutil.copytree("public", release_dir)


def point_current(root: Path, release: str) -> None:
    target = Path("releases") / release
    tmp = root / ".current.tmp"
    if tmp.exists() or tmp.is_symlink():
        tmp.unlink()
    tmp.symlink_to(target)
    tmp.replace(root / "current")


def deploy_local(root: Path, release: str) -> None:
    releases = root / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    copy_public_to_release(releases / release)
    point_current(root, release)


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def deploy_remote(host: str, root: str, release: str) -> None:
    release_dir = f"{root}/releases/{release}"
    run(["ssh", host, f"mkdir -p {shell_quote(release_dir)}"])
    run(["rsync", "-az", "--delete", "public/", f"{host}:{release_dir}/"])
    script = (
        "set -euo pipefail; "
        f"cd {shell_quote(root)}; "
        f"ln -sfn {shell_quote('releases/' + release)} .current.tmp; "
        "mv -T .current.tmp current"
    )
    run(["ssh", host, script])


def cmd_deploy(_args: argparse.Namespace) -> int:
    cfg = mele_config()
    release = release_id()
    run(["hugo", "--gc", "--minify"])
    ensure_public()
    local_root = os.environ.get("MELE_DEPLOY_LOCAL_ROOT")
    if local_root:
        root = Path(local_root)
        deploy_local(root, release)
        print(f"deployed local release: {root / 'releases' / release}")
    else:
        deploy_remote(cfg["host"], cfg["root"], release)
        print(f"deployed MeLE release: {cfg['host']}:{cfg['root']}/releases/{release}")
    print(f"current -> releases/{release}")
    print(f"url: {cfg['url']}")
    return 0


def sorted_releases(root: Path) -> list[str]:
    releases = root / "releases"
    if not releases.is_dir():
        return []
    return sorted(path.name for path in releases.iterdir() if path.is_dir())


def current_release(root: Path) -> str | None:
    current = root / "current"
    if not current.is_symlink():
        return None
    target = os.readlink(current)
    prefix = "releases/"
    return target[len(prefix):] if target.startswith(prefix) else target


def cmd_rollback(args: argparse.Namespace) -> int:
    cfg = mele_config()
    local_root = os.environ.get("MELE_DEPLOY_LOCAL_ROOT")
    if not local_root:
        release = args.release
        if not release:
            raise SystemExit("remote rollback requires --release")
        script = (
            "set -euo pipefail; "
            f"cd {shell_quote(cfg['root'])}; "
            f"test -d {shell_quote('releases/' + release)}; "
            f"ln -sfn {shell_quote('releases/' + release)} .current.tmp; "
            "mv -T .current.tmp current"
        )
        run(["ssh", cfg["host"], script])
        print(f"rolled back current -> releases/{release}")
        print(f"url: {cfg['url']}")
        return 0

    root = Path(local_root)
    releases = sorted_releases(root)
    if not releases:
        raise SystemExit(f"no releases found under {root / 'releases'}")
    release = args.release
    if not release:
        current = current_release(root)
        candidates = [item for item in releases if item != current]
        if not candidates:
            raise SystemExit("no previous release available")
        release = candidates[-1]
    if release not in releases:
        raise SystemExit(f"unknown release {release!r}; known: {', '.join(releases)}")
    point_current(root, release)
    print(f"rolled back current -> releases/{release}")
    print(f"url: {cfg['url']}")
    return 0


def git_has_commits() -> bool:
    return run_status(["git", "rev-parse", "--verify", "HEAD"], quiet=True) == 0


def git_dirty() -> bool:
    return bool(capture(["git", "status", "--porcelain"]))


def ensure_repo_hygiene() -> None:
    if Path(".devenv").exists() and run_status(["git", "check-ignore", "-q", ".devenv"], quiet=True) != 0:
        raise SystemExit(".devenv/ exists but is not ignored; add /.devenv/ to .gitignore")
    if run_status(["git", "ls-files", "--error-unmatch", ".devenv"], quiet=True) == 0:
        raise SystemExit(".devenv/ is already tracked; remove it from git before setup")


def ensure_git_repo(args: argparse.Namespace) -> None:
    if not Path(".git").exists():
        run(["git", "init", "-b", "main"])
    ensure_repo_hygiene()
    if not git_has_commits():
        run(["git", "add", "."])
        run(["git", "commit", "-m", "Initial site"])
        return
    if git_dirty():
        if not args.commit:
            raise SystemExit(
                "working tree is dirty; commit/stash first or rerun with --commit"
            )
        run(["git", "add", "."])
        run(["git", "commit", "-m", "Update site"])


def ensure_gh_auth() -> None:
    try:
        run(["gh", "auth", "status"])
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise SystemExit("GitHub CLI is not installed or not authenticated; run gh auth login") from exc


def default_owner() -> str:
    return capture(["gh", "api", "user", "--jq", ".login"])


def repo_exists(owner: str, repo: str) -> bool:
    return run_status(["gh", "repo", "view", f"{owner}/{repo}"], quiet=True) == 0


def ensure_origin(owner: str, repo: str) -> None:
    url = f"git@github.com:{owner}/{repo}.git"
    if run_status(["git", "remote", "get-url", "origin"], quiet=True) == 0:
        run(["git", "remote", "set-url", "origin", url])
    else:
        run(["git", "remote", "add", "origin", url])


def create_repo(owner: str, repo: str, private: bool) -> None:
    if repo_exists(owner, repo):
        print(f"GitHub repository already exists: {owner}/{repo}")
        ensure_origin(owner, repo)
        return
    visibility = "--private" if private else "--public"
    run([
        "gh",
        "repo",
        "create",
        f"{owner}/{repo}",
        visibility,
        "--source",
        ".",
        "--remote",
        "origin",
    ])


def github_pages_url(owner: str, repo: str) -> str:
    return f"https://{owner}.github.io/{repo}/"


def gh_api_pages(command: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["gh", "api", *command],
        check=False,
        text=True,
        capture_output=True,
    )


def setup_pages(owner: str, repo: str) -> None:
    path = f"repos/{owner}/{repo}/pages"
    create = gh_api_pages(["-X", "POST", path, "-f", "build_type=workflow"])
    if create.returncode == 0:
        print("GitHub Pages configured for Actions")
        return
    create_output = (create.stdout + create.stderr).strip()
    if "current plan does not support GitHub Pages" in create_output:
        raise SystemExit(
            "GitHub Pages is not supported for this private repository on the current GitHub plan. "
            "Rerun without --private for a public Pages backup, or upgrade/configure Pages manually."
        )

    patch = gh_api_pages(["-X", "PATCH", path, "-f", "build_type=workflow"])
    if patch.returncode == 0:
        print("GitHub Pages configured for Actions")
        return
    patch_output = (patch.stdout + patch.stderr).strip()
    print("Could not configure GitHub Pages automatically.", file=sys.stderr)
    if create_output:
        print(create_output, file=sys.stderr)
    if patch_output:
        print(patch_output, file=sys.stderr)
    print("Manual fallback: Settings → Pages → Source: GitHub Actions", file=sys.stderr)


def latest_pages_run_id() -> str | None:
    try:
        output = capture([
            "gh",
            "run",
            "list",
            "--workflow",
            "pages.yml",
            "--limit",
            "1",
            "--json",
            "databaseId",
            "--jq",
            ".[0].databaseId // empty",
        ])
    except subprocess.CalledProcessError:
        return None
    return output or None


def actions_url(run_id: str) -> str:
    try:
        return capture(["gh", "run", "view", run_id, "--json", "url", "--jq", ".url"])
    except subprocess.CalledProcessError:
        return f"https://github.com/{capture(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])}/actions/runs/{run_id}"


def wait_for_pages_workflow() -> None:
    run_id = None
    for _ in range(24):
        run_id = latest_pages_run_id()
        if run_id:
            break
        time.sleep(5)
    if not run_id:
        raise SystemExit("no GitHub Pages workflow run found; check Actions tab")
    try:
        run(["gh", "run", "watch", run_id, "--exit-status"])
    except subprocess.CalledProcessError as exc:
        url = actions_url(run_id)
        print("GitHub Pages workflow failed.", file=sys.stderr)
        print(f"Actions URL: {url}", file=sys.stderr)
        print(f"Inspect failed logs with: gh run view {run_id} --log-failed", file=sys.stderr)
        raise SystemExit(1) from exc


def cmd_github_setup(args: argparse.Namespace) -> int:
    cfg = mele_config()
    repo = args.repo or cfg["site"]
    ensure_gh_auth()
    owner = args.owner or default_owner()
    doctor_env = dict(os.environ)
    doctor_env["MELE_SKIP_SSH_CHECK"] = "1"
    run(["site:doctor"], env=doctor_env)
    ensure_git_repo(args)
    create_repo(owner, repo, args.private)
    setup_pages(owner, repo)
    run(["git", "push", "-u", "origin", "main"])
    if not args.no_wait:
        wait_for_pages_workflow()
    url = github_pages_url(owner, repo)
    print(f"GitHub Pages URL: {url}")
    if not args.no_open:
        webbrowser.open(url)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hugo static site helper")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("deploy-mele")
    rollback = subparsers.add_parser("rollback-mele")
    rollback.add_argument("--release")
    github_setup = subparsers.add_parser("github-setup")
    github_setup.add_argument("--owner")
    github_setup.add_argument("--repo")
    github_setup.add_argument("--private", action="store_true")
    github_setup.add_argument("--commit", action="store_true")
    github_setup.add_argument("--no-wait", action="store_true")
    github_setup.add_argument("--no-open", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "deploy-mele":
        return cmd_deploy(args)
    if args.command == "rollback-mele":
        return cmd_rollback(args)
    if args.command == "github-setup":
        return cmd_github_setup(args)
    raise SystemExit(f"unimplemented command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
