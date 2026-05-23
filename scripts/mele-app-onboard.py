#!/usr/bin/env python3
"""Print snippets to onboard an existing project to MeLE app deploys."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

APP_RE = re.compile(r"^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$")
DEFAULT_INPUT = "github:behaghel/nixos-config"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Print devenv snippets for MeLE app deployment tooling.",
    )
    parser.add_argument("project", type=Path, help="Existing project directory")
    parser.add_argument("--app-name", required=True, help="MeLE app slot name")
    parser.add_argument(
        "--input-url",
        default=DEFAULT_INPUT,
        help=f"devenv input URL for nixos-config, default: {DEFAULT_INPUT}",
    )
    return parser.parse_args()


def yaml_snippet(input_url: str) -> str:
    return f'''# devenv.yaml
inputs:
  nixos-config:
    url: {input_url}
    flake: false
imports:
  - nixos-config/modules/flake/mele-app
'''


def nix_snippet(app_name: str) -> str:
    return f'''# devenv.nix
{{ ... }}:
{{
  mele.app = {{
    enable = true;
    name = "{app_name}";
  }};
}}
'''


def main() -> int:
    args = parse_args()
    if not APP_RE.fullmatch(args.app_name):
        print(
            "app name must be lowercase kebab-case, e.g. home or hedonis",
            file=sys.stderr,
        )
        return 2

    project = args.project.expanduser().resolve()
    if not project.is_dir():
        print(f"project directory does not exist: {project}", file=sys.stderr)
        return 1

    print(f"# MeLE app onboarding for {project}")
    print()
    print(yaml_snippet(args.input_url))
    print(nix_snippet(args.app_name))
    print("# Expected flake output: .#ociImage")
    print("# Optional runtime override: MELE_HOST=hub@host mele:deploy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
