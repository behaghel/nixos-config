#!/usr/bin/env python3
"""Promote explicitly selected pass entries into macOS Keychain.

Only encrypted-file fingerprints and entry names are persisted. No plaintext is
passed as a process argument or written to a file by this program.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib


class PromotionError(Exception):
    """A safe-to-display promotion failure."""

    def __init__(self, message, code="credential_operation_unavailable"):
        super().__init__(message)
        self.code = code


def selected_entries(values):
    """Parse pass-entry[=keychain-service] mappings without scanning pass."""
    entries = {}
    for value in values:
        source, sep, service = value.partition("=")
        if not sep:
            service = source
        if (
            not source
            or not service
            or source.startswith("/")
            or any(part in ("", ".", "..") for part in source.split("/"))
            or "\x00" in value
            or service in entries
        ):
            raise PromotionError("invalid or duplicate --entry mapping")
        entries[service] = source
    if not entries:
        raise PromotionError("at least one --entry is required")
    return entries


def digest(store, source):
    """Fingerprint the ciphertext; never ask GPG for plaintext here."""
    path = store / (source + ".gpg")
    if (
        not path.resolve().is_relative_to(store.resolve())
        or not path.is_file()
    ):
        raise PromotionError(
            f"pass ciphertext missing or outside store: {source}"
        )
    sha = hashlib.sha256()
    with path.open("rb") as encrypted:
        for block in iter(lambda: encrypted.read(65536), b""):
            sha.update(block)
    return sha.hexdigest()


def keychain_value(binary, account, service):
    result = subprocess.run(
        [binary, "find-generic-password", "-a", account, "-s", service, "-w"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode == 44:  # errSecItemNotFound (-25300) from security(1)
        return None
    if result.returncode:
        raise PromotionError(
            f"Keychain lookup failed for {service} ({result.returncode})"
        )
    return result.stdout.removesuffix(b"\n")


def pass_value(binary, source):
    result = subprocess.run(
        [binary, "show", source],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        # pass/gpg stderr can include sensitive details: do not forward it.
        raise PromotionError(
            f"pass export failed for {source} ({result.returncode})"
        )
    secret = result.stdout.split(b"\n", 1)[0]
    if not secret or b"\x00" in secret:
        raise PromotionError(f"pass entry has an invalid first line: {source}")
    return secret


def write_keychain(binary, account, service, secret):
    # Unlike `security add-generic-password -w <value>`, no secret enters argv.
    result = subprocess.run(
        [binary, "write", account, service],
        input=secret,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise PromotionError(
            f"Keychain write failed for {service} ({result.returncode})"
        )


def load_state(path, account):
    if path.is_symlink():
        raise PromotionError("state file must not be a symlink")
    if not path.exists():
        return {}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PromotionError("cannot read promotion state") from exc
    if (
        not isinstance(state, dict)
        or state.get("version") != 1
        or state.get("account") != account
    ):
        raise PromotionError("promotion state has another version or account")
    if not isinstance(state.get("entries"), dict):
        raise PromotionError("invalid promotion state entries")
    return state["entries"]


def save_state(path, account, entries):
    """Commit the baseline only after all changes have been verified."""
    payload = json.dumps(
        {"version": 1, "account": account, "entries": entries},
        sort_keys=True,
    )
    fd, temporary = tempfile.mkstemp(prefix=".pass-keychain-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def execute(args):
    entries = selected_entries(args.entry)
    security = os.environ.get(
        "PASS_KEYCHAIN_SECURITY_BIN", "/usr/bin/security"
    )
    password_store = Path(
        os.environ.get("PASSWORD_STORE_DIR", "~/.password-store")
    ).expanduser()

    if args.action == "check":
        for service in entries:
            if keychain_value(security, args.account, service) in (None, b""):
                raise PromotionError(
                    f"Keychain item missing or empty: {service}"
                )
        return

    state_file = Path(args.state_file).expanduser()
    state_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state_file.is_symlink():
        raise PromotionError("state file must not be a symlink")
    lock_path = str(state_file) + ".lock"
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(lock_path, flags, 0o600), "r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old_entries = load_state(state_file, args.account)
        # Check ciphertext before accessing secrets or updating Keychain.
        current = {
            service: {"pass_entry": source,
                      "ciphertext_sha256": digest(password_store, source)}
            for service, source in entries.items()
        }
        for service, source in entries.items():
            actual = keychain_value(security, args.account, service)
            if (args.action == "ensure" and actual not in (None, b"")
                    and old_entries.get(service) == current[service]):
                continue
            expected = pass_value(args.pass_bin, source)
            if actual != expected:
                write_keychain(
                    args.writer_bin, args.account, service, expected
                )
                if keychain_value(security, args.account, service) != expected:
                    raise PromotionError(
                        f"Keychain read-back failed for {service}"
                    )
        save_state(state_file, args.account, current)


def profile_manifest(path, profile):
    """Resolve declarations without applying defaults to stored values."""
    try:
        config = tomllib.loads(path.read_text(encoding="utf-8"))
        project = config["project"]["name"]
        profiles = config["profiles"]
        if profile not in profiles:
            raise PromotionError("profile unavailable", "profile_unavailable")
        base = dict(profiles.get("default", {}))
        selected = dict(profiles[profile])
        defaults = {**base.pop("defaults", {}),
                    **selected.pop("defaults", {})}
        keys = dict(base)
        for key, value in selected.items():
            keys[key] = {**base.get(key, {}), **value}
        keys = {key: {**defaults, **value}
                for key, value in keys.items()}
        if not isinstance(project, str) or not project or not keys:
            raise ValueError()
        if any(
            value.get("providers") or value.get("as_path")
            or value.get("generate") for value in keys.values()
        ):
            raise PromotionError(
                "profile settings can redirect credentials",
                "unsupported_profile_settings",
            )
        return project, keys
    except PromotionError:
        raise
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise PromotionError(
            "SecretSpec manifest unavailable", "manifest_unavailable"
        ) from exc


def profile_read(path, project, profile, keys, provider, kind):
    """Read only stored values, not defaults or inherited credentials."""
    inventory = (
        '[project]\n'
        f'name = {json.dumps(project)}\n'
        'revision = "1.0"\n'
        f'[profiles.{json.dumps(profile)}]\n'
    ) + "".join(
        f'{json.dumps(key)} = {{ required = false }}\n' for key in keys
    )
    exported = (
        "import json,os,sys; "
        "print(json.dumps({k:os.environ[k] for k in json.loads(sys.argv[1]) "
        "if os.environ.get(k)}))"
    )
    env = dict(os.environ)
    for key in [*keys, "SECRETSPEC_PROVIDER", "SECRETSPEC_FILE",
                "SECRETSPEC_PROFILE"]:
        env.pop(key, None)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".toml") as temporary:
        temporary.write(inventory)
        temporary.flush()
        try:
            result = subprocess.run(
                [os.environ.get("PASS_KEYCHAIN_SECRETSPEC_BIN", "secretspec"),
                 "--file", temporary.name, "run", "--provider", provider,
                 "--profile", profile, "--", sys.executable, "-c", exported,
                 json.dumps(list(keys))],
                env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=180, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PromotionError(
                "SecretSpec inventory read unavailable",
                f"{kind}_unavailable",
            ) from exc
    if result.returncode:
        raise PromotionError(
            "SecretSpec inventory read unavailable", f"{kind}_unavailable"
        )
    try:
        values = json.loads(result.stdout)
        if not isinstance(values, dict) or any(
            key not in keys or not isinstance(value, str)
            for key, value in values.items()
        ):
            raise ValueError()
        return values
    except ValueError as exc:
        raise PromotionError(
            "invalid SecretSpec inventory", f"{kind}_unavailable"
        ) from exc


def profile_state_path(args, path, project):
    if args.state_file:
        return Path(args.state_file).expanduser()
    home = Path(
        os.environ.get("XDG_STATE_HOME", "~/.local/state")
    ).expanduser()
    name = hashlib.sha256(
        json.dumps([str(path), project, args.profile]).encode()
    ).hexdigest()
    return home / "pass-keychain" / (name + ".json")


def profile_write(path, profile, provider, key, value, keys):
    env = dict(os.environ)
    for name in [*keys, "SECRETSPEC_PROVIDER", "SECRETSPEC_PROFILE",
                 "SECRETSPEC_FILE"]:
        env.pop(name, None)
    try:
        result = subprocess.run(
            [os.environ.get("PASS_KEYCHAIN_SECRETSPEC_BIN", "secretspec"),
             "--file", str(path), "set", key, "--provider", provider,
             "--profile", profile],
            env=env, input=value.encode(), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=180, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PromotionError(
            "Keychain write unavailable", "target_write_unavailable"
        ) from exc
    if result.returncode:
        raise PromotionError(
            "Keychain write unavailable", "target_write_unavailable"
        )


def execute_profile(args, report):
    """Select a profile, promote values, and verify the target."""
    path = Path(args.file).resolve()
    project, keys = profile_manifest(path, args.profile)
    state_file = profile_state_path(args, path, project)
    state_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    lock_fd = os.open(str(state_file) + ".lock", flags, 0o600)
    with os.fdopen(lock_fd, "r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source_provider = f"pass://{project}/{args.profile}/{{key}}"
        target_provider = f"keyring://{project}/{args.profile}/{{key}}"
        target = profile_read(
            path, project, args.profile, keys, target_provider, "target"
        )
        if args.action == "check":
            if any(config.get("required", True) and not target.get(key)
                   for key, config in keys.items()):
                raise PromotionError(
                    "required Keychain items missing",
                    "required_credentials_missing",
                )
            if not target:
                raise PromotionError("no Keychain items", "no_credentials")
            return {**report, "result": "verified", "available": len(target)}

        account = f"secretspec:{path}:{project}/{args.profile}"
        previous = load_state(state_file, account)
        store = Path(os.environ.get(
            "PASSWORD_STORE_DIR", "~/.password-store"
        )).expanduser()
        # A missing optional ciphertext must neither be decrypted nor deleted.
        present = {}
        for key, config in keys.items():
            entry = f"{project}/{args.profile}/{key}"
            encrypted = store / (entry + ".gpg")
            if encrypted.is_file():
                present[key] = {
                    "pass_entry": entry,
                    "ciphertext_sha256": digest(store, entry),
                }
            elif config.get("required", True):
                raise PromotionError(
                    "required source entry missing",
                    "required_credentials_missing",
                )
        selected = [
            key for key in present
            if args.action != "ensure" or key not in target
            or previous.get(key) != present[key]
        ]
        source = profile_read(
            path, project, args.profile, selected, source_provider,
            "source",
        ) if selected else {}
        if any(keys[key].get("required", True) and not source.get(key)
               for key in selected):
            raise PromotionError(
                "required source credentials missing",
                "required_credentials_missing",
            )
        if not present or (not source and args.action != "ensure"):
            raise PromotionError("no source credentials", "no_credentials")
        # SecretSpec 0.8's stdin setter trims edges. Refuse before any write.
        if any(not value or value != value.strip() or "\x00" in value
               for value in source.values()):
            raise PromotionError(
                "source cannot be preserved by SecretSpec",
                "source_value_not_losslessly_representable",
            )
        if any(
            key in target and target[key] != value
            and (args.action == "promote" or
                 (args.action == "ensure" and key not in previous))
            for key, value in source.items()
        ):
            raise PromotionError(
                "target conflict; use refresh to rotate", "target_conflict"
            )
        for key, value in source.items():
            if target.get(key) == value:
                report["unchanged"] += 1
                continue
            profile_write(
                path, args.profile, target_provider, key, value, keys
            )
            report["updated" if key in target else "created"] += 1
        if source:
            observed = profile_read(
                path, project, args.profile, keys, target_provider, "target"
            )
            if any(observed.get(key) != value
                   for key, value in source.items()):
                raise PromotionError(
                    "Keychain read-back failed", "target_verification_failed"
                )
        else:
            observed = target
        # Only record the baseline after all selected writes and reads succeed.
        save_state(state_file, account, present)
        return {**report, "result": "verified", "available": len(observed)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("ensure", "refresh", "check",
                                            "promote"))
    parser.add_argument("--file", help="SecretSpec manifest (profile mode)")
    parser.add_argument("--profile", default="live")
    parser.add_argument("--account")
    parser.add_argument("--entry", action="append", default=[],
                        help="pass entry, or pass-entry=keychain-service")
    parser.add_argument(
        "--state-file",
        help="separate state file per account/profile (ensure/refresh)",
    )
    parser.add_argument("--pass-bin", default=os.environ.get(
        "PASS_KEYCHAIN_PASS_BIN", "pass"))
    parser.add_argument("--writer-bin", default=os.environ.get(
        "PASS_KEYCHAIN_WRITER_BIN", "pass-keychain-write"))
    args = parser.parse_args()
    if args.file:
        if args.entry or args.account:
            parser.error("--file cannot be combined with raw entry options")
    elif not args.account or not args.entry:
        parser.error("--account and --entry are required without --file")
    elif args.action == "promote":
        parser.error("promote requires --file")
    elif args.action != "check" and not args.state_file:
        parser.error("--state-file is required for ensure and refresh")
    report = {"action": args.action, "profile": args.profile,
              "created": 0, "updated": 0, "unchanged": 0}
    try:
        if args.file:
            print(json.dumps(execute_profile(args, report)))
        else:
            execute(args)
    except (PromotionError, OSError, BlockingIOError) as exc:
        if args.file:
            code = getattr(exc, "code", "credential_operation_unavailable")
            print(json.dumps({**report, "result": code}))
        else:
            print(f"pass-keychain: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
