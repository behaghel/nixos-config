#!/usr/bin/env python3
"""Deprecated wrapper for `mele-app create`."""

from __future__ import annotations

import sys

import mele_app_cli


if __name__ == "__main__":
    print(
        "warning: scripts/mele-app-create.py is deprecated; use `mele-app create`",
        file=sys.stderr,
    )
    raise SystemExit(mele_app_cli.main(["create", *sys.argv[1:]]))
