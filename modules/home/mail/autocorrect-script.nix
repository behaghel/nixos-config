{ pkgs }:
pkgs.writers.writePython3Bin "mail-sync-autocorrect" { } ''
import argparse
import os
import pathlib
import re
import sys
from typing import Optional

DEFAULT_ROOT = pathlib.Path(
    os.environ.get("MAIL_SYNC_ROOT", pathlib.Path.home() / "Mail")
).expanduser()
DUP_RE = re.compile(r"duplicate UID (\d+) in (.+)")
BEYOND_RE = re.compile(r"UID (\d+) is beyond highest assigned UID \d+ in (.+)")
UID_SUFFIX_ANY = re.compile(r",U=\d+")


def parse_issue(line: str):
    line = line.strip()
    if not line:
        return None
    for pattern in (DUP_RE, BEYOND_RE):
        match = pattern.search(line)
        if match:
            uid = int(match.group(1))
            path = match.group(2).strip()
            if path.endswith('.'):
                path = path[:-1]
            return uid, path
    return None


def scrub_dir(path: pathlib.Path, uid: int, dry_run: bool):
    changed = False
    if not path.exists() or not path.is_dir():
        return False
    pattern = re.compile(rf",U={uid}(?=$|[^0-9])")
    for entry in path.iterdir():
        if not entry.is_file():
            continue
        match = pattern.search(entry.name)
        if not match:
            continue
        new_name = pattern.sub("", entry.name, count=1)
        dest = entry.with_name(new_name)
        if dest.exists():
            print(
                f"mail-sync-autocorrect: target exists, skip {entry}",
                file=sys.stderr,
            )
            continue
        if dry_run:
            print(
                f"mail-sync-autocorrect: would rename {entry} -> {dest}",
                file=sys.stderr,
            )
        else:
            entry.rename(dest)
            print(
                f"mail-sync-autocorrect: renamed {entry} -> {dest}",
                file=sys.stderr,
            )
        changed = True
    return changed


def scrub_scope(base: pathlib.Path, uid: int, dry_run: bool):
    changed = False
    for sub in (base, base / "cur", base / "new"):
        if scrub_dir(sub, uid, dry_run):
            changed = True
    return changed


def scrub_all(root: pathlib.Path,
              target: Optional[pathlib.Path],
              dry_run: bool):
    base = root if target is None else target
    if not base.exists():
        print(
            f"mail-sync-autocorrect: force scope missing: {base}",
            file=sys.stderr,
        )
        return False

    changed = False
    for file in base.rglob("*"):
        if not file.is_file():
            continue
        if not UID_SUFFIX_ANY.search(file.name):
            continue
        new_name = UID_SUFFIX_ANY.sub("", file.name)
        dest = file.with_name(new_name)
        if dest.exists():
            print(
                "mail-sync-autocorrect: target exists during force scrub: "
                f"{dest}",
                file=sys.stderr,
            )
            continue
        if dry_run:
            print(
                f"mail-sync-autocorrect: would rename {file} -> {dest}",
                file=sys.stderr,
            )
        else:
            file.rename(dest)
            print(
                f"mail-sync-autocorrect: renamed {file} -> {dest}",
                file=sys.stderr,
            )
        changed = True
    return changed


def resolve_scope(
    root: pathlib.Path, scope: Optional[str]
) -> Optional[pathlib.Path]:
    if not scope:
        return None
    path = pathlib.Path(scope).expanduser()
    if not path.is_absolute():
        path = root / path
    try:
        path.relative_to(root)
    except ValueError:
        raise ValueError(f"scope {path} is outside root {root}")
    return path


def main():
    parser = argparse.ArgumentParser(
        description="Fix Maildir UID conflicts reported by mbsync"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log actions without renaming files",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="Maildir root (defaults to $MAIL_SYNC_ROOT or ~/Mail)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Scrub all ,U= markers before running mbsync",
    )
    parser.add_argument(
        "--scope",
        default=None,
        help=(
            "Limit force scrub to a subdirectory "
            "(absolute or relative to root)"
        ),
    )
    args = parser.parse_args()

    root = pathlib.Path(args.root).expanduser() if args.root else DEFAULT_ROOT

    if args.force:
        try:
            target = resolve_scope(root, args.scope)
        except ValueError as exc:
            print(f"mail-sync-autocorrect: {exc}", file=sys.stderr)
            sys.exit(2)
        scrub_all(root, target, args.dry_run)
        return

    found_issue = False
    fixed = False

    for raw_line in sys.stdin:
        parsed = parse_issue(raw_line)
        if not parsed:
            continue
        found_issue = True
        uid, path_str = parsed
        path = pathlib.Path(path_str)
        try:
            rel = path.relative_to(root)
        except ValueError:
            print(
                "mail-sync-autocorrect: skipping path outside Maildir: "
                f"{path}",
                file=sys.stderr,
            )
            continue
        base = root / rel
        if scrub_scope(base, uid, args.dry_run):
            fixed = True

    if not found_issue:
        sys.exit(1)
    if not fixed:
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
''
