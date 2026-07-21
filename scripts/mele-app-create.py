#!/usr/bin/env python3
"""Create a declarative MeLE app slot file."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

APP_RE = re.compile(r"^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$")
PORT_RE = re.compile(r"\bhostPort\s*=\s*(\d+)\s*;")
ROOT = Path(__file__).resolve().parents[1]
APPS_DIR = ROOT / "configurations" / "nixos" / "mele-hub" / "apps"
BASE_DOMAIN = "home.behaghel.org"
FIRST_APP_PORT = 8101


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create a conventional MeLE app slot under "
            "configurations/nixos/mele-hub/apps."
        ),
    )
    parser.add_argument("name", help="App name, e.g. notes or my-app")
    parser.add_argument(
        "--domain",
        help="Override domain; defaults to <name>.home.behaghel.org",
    )
    parser.add_argument("--host-port", type=int, help="Override localhost host port")
    parser.add_argument(
        "--container-port",
        type=int,
        default=8080,
        help="Container port, default: 8080",
    )
    parser.add_argument(
        "--exposure",
        choices=("public", "lan"),
        default="public",
        help="Exposure mode, default: public",
    )
    parser.add_argument(
        "--health-path",
        default="/health",
        help="Health path, default: /health",
    )
    parser.add_argument(
        "--no-metrics",
        action="store_true",
        help="Disable /metrics scraping",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the file that would be written",
    )
    return parser.parse_args()


def existing_ports() -> list[int]:
    ports: list[int] = []
    for path in APPS_DIR.glob("*.nix"):
        match = PORT_RE.search(path.read_text())
        if match:
            ports.append(int(match.group(1)))
    return ports


def next_port() -> int:
    used = set(existing_ports())
    port = FIRST_APP_PORT
    while port in used:
        port += 1
    return port


def nix_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def render_slot(args: argparse.Namespace, host_port: int, domain: str) -> str:
    lines = ["{", f"  exposure = {nix_string(args.exposure)};"]
    if domain != f"{args.name}.{BASE_DOMAIN}":
        lines.append(f"  domain = {nix_string(domain)};")
    lines.extend(
        [
            f"  hostPort = {host_port};",
            f"  containerPort = {args.container_port};",
            f"  healthPath = {nix_string(args.health_path)};",
        ]
    )
    if not args.no_metrics:
        lines.extend(
            [
                "  metrics = {",
                "    enable = true;",
                f"    path = {nix_string('/metrics')};",
                "  };",
            ]
        )
    lines.append("}")
    return "\n".join(lines) + "\n"


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def validate_generated_config(app_name: str) -> None:
    # Flake evaluation ignores untracked files. Stage the generated slot before
    # validation so getFlake sees the same app file the user is about to commit.
    run(["git", "add", str(APPS_DIR / f"{app_name}.nix")])
    expr = (
        '(builtins.getAttr "mele-apps/config.json" '
        '(builtins.getFlake "git+file://'
        + str(ROOT)
        + '").nixosConfigurations.mele-hub.config.environment.etc).text'
    )
    result = run(["nix", "eval", "--impure", "--raw", "--expr", expr])
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    data = json.loads(result.stdout)
    if app_name not in data.get("apps", {}):
        raise SystemExit(f"generated config does not include app {app_name!r}")


def main() -> int:
    args = parse_args()
    if not APP_RE.fullmatch(args.name):
        print(
            "app name must be lowercase kebab-case, e.g. notes or my-app",
            file=sys.stderr,
        )
        return 2

    APPS_DIR.mkdir(parents=True, exist_ok=True)
    target = APPS_DIR / f"{args.name}.nix"
    if target.exists():
        print(f"app slot already exists: {target}", file=sys.stderr)
        return 1

    host_port = args.host_port or next_port()
    used_ports = set(existing_ports())
    if host_port in used_ports:
        print(f"host port already in use: {host_port}", file=sys.stderr)
        return 1

    domain = args.domain or f"{args.name}.{BASE_DOMAIN}"
    content = render_slot(args, host_port, domain)

    if args.dry_run:
        print(content, end="")
        return 0

    target.write_text(content)
    validate_generated_config(args.name)
    rel_target = target.relative_to(ROOT)
    print(f"Created {rel_target}")
    print(f"  app: {args.name}")
    print(f"  domain: {domain}")
    print(f"  hostPort: {host_port}")
    print("Validated generated /etc/mele-apps/config.json")
    print()
    print("Next steps:")
    print(f"  git add {rel_target}")
    print("  git commit -m 'mele: add " + args.name + " app slot'")
    print("  devenv -q shell -- mele:activate")
    print()
    print("Recommended project initialization:")
    params = json.dumps({"app-name": args.name}, separators=(",", ":"))
    print(
        f"  om init --non-interactive --params '{params}' "
        f"-o ~/ws/{args.name} {ROOT}#mele-vite-app"
    )
    print()
    print("This single value derives package name, MeLE app name, image name, title,")
    print("and default API message:")
    print(f"  app-name: {args.name}")
    print()
    print("Fallback without Omnix:")
    print(f"  nix flake new ~/ws/{args.name} --template {ROOT}#mele-vite-app")
    print(f"  # then replace example -> {args.name}")
    print()
    print("Activation is required for this new app slot. Normal app releases after")
    print("this onboarding step should use mele:deploy from the app project instead.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
