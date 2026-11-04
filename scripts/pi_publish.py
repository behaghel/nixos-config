#!/usr/bin/env python3
"""Interactively publish a reviewed Pi package tarball through npm."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class PublishError(Exception):
    """A publication step could not establish its required outcome."""


def run(args, cwd, capture=False, check=True):
    result = subprocess.run(
        args, cwd=cwd, text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    if check and result.returncode:
        if capture and result.stdout:
            print(result.stdout, file=sys.stderr, end="")
        raise subprocess.CalledProcessError(result.returncode, args)
    return result


def output(args, cwd):
    return run(args, cwd, capture=True).stdout.strip()


def json_output(args, cwd):
    text = output(args, cwd)
    try:
        return json.loads(text)
    except ValueError:
        print(text, file=sys.stderr)
        raise


def clean_source(root, package, expected_head=None):
    relative = package.relative_to(root).as_posix()
    output(["git", "ls-files", "--error-unmatch",
            f"{relative}/package.json"], root)
    dirty = output([
        "git", "status", "--porcelain", "--untracked-files=all", "--", relative,
    ], root)
    if dirty:
        raise PublishError("Package has uncommitted changes:\n" + dirty)
    head = output(["git", "rev-parse", "HEAD"], root)
    if expected_head is not None and head != expected_head:
        raise PublishError("Source revision changed; review a new tarball.")
    return head


def registry_for(manifest, package):
    settings = manifest.get("publishConfig", {})
    name = manifest["name"]
    registry = None
    if name.startswith("@"):
        key = name.split("/")[0] + ":registry"
        registry = settings.get(key) or output(
            ["npm", "config", "get", key], package,
        )
        if registry in ("undefined", "null", ""):
            registry = None
    registry = registry or settings.get("registry") or output(
        ["npm", "config", "get", "registry"], package,
    )
    parsed = urlsplit(registry)
    if (parsed.scheme not in ("http", "https") or not parsed.netloc
            or parsed.username or parsed.password or parsed.query
            or parsed.fragment):
        raise PublishError(
            "Use an HTTP(S) registry URL without embedded credentials; "
            "configure authentication through npm.")
    return registry


def integrity_of(path):
    digest = hashlib.sha512(path.read_bytes()).digest()
    return "sha512-" + base64.b64encode(digest).decode()


def registry_diagnostics(result):
    if result is None:
        return
    for text in (result.stdout, result.stderr):
        if text:
            if isinstance(text, bytes):
                text = text.decode("utf-8", errors="backslashreplace")
            print(text, file=sys.stderr, end="" if text.endswith("\n") else "\n")


def verify_registry(spec, version, integrity, registry, package,
                    wait_seconds=180, poll_seconds=5):
    deadline = time.monotonic() + wait_seconds
    result = None
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            result = subprocess.run(
                ["npm", "view", spec, "--json", "--registry", registry],
                cwd=package, text=True, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=min(30, remaining),
            )
        except subprocess.TimeoutExpired as error:
            registry_diagnostics(error)
            raise PublishError(
                "Publication reported success, but registry verification "
                "timed out. Do not republish; inspect the exact version later."
            ) from error
        try:
            registered = json.loads(result.stdout)
        except ValueError as error:
            registry_diagnostics(result)
            raise PublishError(
                "Publication reported success, but registry verification "
                "returned invalid JSON. Do not republish."
            ) from error
        if (result.returncode and isinstance(registered, dict)
                and isinstance(registered.get("error"), dict)
                and registered["error"].get("code") == "E404"):
            remaining = deadline - time.monotonic()
            if remaining > 0:
                print("Waiting for registry visibility "
                      f"({remaining:.0f}s remaining)...", flush=True)
                time.sleep(min(poll_seconds, remaining))
                continue
            break
        if result.returncode:
            registry_diagnostics(result)
            raise PublishError(
                "Publication reported success, but registry verification "
                "is incomplete. Do not republish; inspect the exact version.")
        if (not isinstance(registered, dict)
                or registered.get("version") != version
                or not isinstance(registered.get("dist"), dict)
                or registered["dist"].get("integrity") != integrity):
            registry_diagnostics(result)
            raise PublishError(
                "Registry verification does not match the reviewed tarball. "
                "Do not republish; inspect the exact version.")
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        return
    registry_diagnostics(result)
    raise PublishError(
        "Publication reported success, but the version is not visible "
        f"after {wait_seconds}s of registry verification. "
        "Do not republish; inspect the exact version later.")


def publish(extension, root=ROOT):
    if not sys.stdin.isatty():
        raise PublishError("Publishing requires an interactive terminal.")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", extension):
        raise PublishError("Expected a marketplace plugin directory name.")
    root = root.resolve()
    plugins = root / "marketplace/plugins"
    package = (plugins / extension).resolve()
    if not package.is_relative_to(plugins.resolve()):
        raise PublishError("Package must belong to this marketplace.")
    manifest = json.loads((package / "package.json").read_text())
    if not isinstance(manifest.get("pi"), dict) or manifest.get("private"):
        raise PublishError("Expected a non-private Pi package.")
    if manifest.get("publishConfig", {}).get("access", "public") != "public":
        raise PublishError("Package declares non-public access; refusing override.")
    name, version = manifest["name"], manifest["version"]
    spec = f"{name}@{version}"
    head = clean_source(root, package)
    branch = output(["git", "branch", "--show-current"], root) or "detached"
    registry = registry_for(manifest, package)
    tag = manifest.get("publishConfig", {}).get("tag", "latest")
    print(f"\nPackage: {spec}\nSource: {package}\nRevision: {head} ({branch})"
          f"\nRegistry: {registry}\nTag: {tag}\nAccess: public\n", flush=True)

    if (package / "package-lock.json").exists():
        run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
            package)
    else:
        print("No package lock: dependency installation skipped.", flush=True)
    if "test" in manifest.get("scripts", {}):
        run(["npm", "test"], package)
    else:
        print("No package test script: tests skipped.", flush=True)

    with tempfile.TemporaryDirectory(prefix="pi-publish-") as temp:
        packed = json_output([
            "npm", "pack", "--json", "--pack-destination", temp,
        ], package)
        if len(packed) != 1:
            raise PublishError("npm pack did not identify one tarball.")
        receipt = packed[0]
        if receipt.get("name") != name or receipt.get("version") != version:
            raise PublishError("Packed package identity changed.")
        tarball = (Path(temp) / receipt["filename"]).resolve()
        if tarball.parent != Path(temp).resolve():
            raise PublishError("npm pack returned an unexpected tarball path.")
        integrity = integrity_of(tarball)
        if receipt.get("integrity") != integrity:
            raise PublishError("Packed tarball integrity does not match.")
        clean_source(root, package, head)
        print("\nReview the actual tarball contents:", flush=True)
        for entry in receipt["files"]:
            print(f"  {entry['path']} ({entry['size']} bytes)")
        print(f"Tarball: {tarball}\nIntegrity: {integrity}\n", flush=True)

        account = run(["npm", "whoami", "--registry", registry], package,
                      capture=True, check=False)
        if account.returncode:
            if account.stdout:
                print(account.stdout, end="")
            if input("Account check failed. Run npm login? [y/N] ").lower() != "y":
                print("Cancelled; nothing published.")
                return 0
            run(["npm", "login", "--registry", registry], package)
            account = run(["npm", "whoami", "--registry", registry], package,
                          capture=True)
        print("npm account: " + account.stdout.strip(), flush=True)
        if input(f"Type {spec} to publish publicly, or Enter to cancel: ") != spec:
            print("Cancelled; nothing published.")
            return 0
        clean_source(root, package, head)
        if integrity_of(tarball) != integrity:
            raise PublishError("Reviewed tarball changed; publication refused.")
        result = run([
            "npm", "publish", str(tarball), "--access", "public",
            "--tag", tag, "--registry", registry,
        ], package, check=False)
        if result.returncode:
            raise PublishError(
                "Publication not confirmed. The registry may have accepted "
                "it; inspect the exact version before retrying.")
        print("npm reported publication success; checking the registry.",
              flush=True)
        verify_registry(spec, version, integrity, registry, package)
        print(f"Verified {spec} on {registry} against the reviewed tarball.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension", help="Marketplace plugin directory name")
    args = parser.parse_args()
    try:
        return publish(args.extension)
    except (KeyboardInterrupt, EOFError):
        print("\nInterrupted. If publication started, check the registry "
              "before retrying.", file=sys.stderr)
        return 130
    except subprocess.CalledProcessError as error:
        print(f"Step failed with exit {error.returncode}: "
              + " ".join(error.cmd), file=sys.stderr)
        return 1
    except (PublishError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
