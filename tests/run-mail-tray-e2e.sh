#!/usr/bin/env bash
set -euo pipefail

root_dir=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root_dir"

system=$(nix eval --impure --raw --expr 'builtins.currentSystem')

tray_expr=$(cat <<EOF
let
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
  dummyConfig = {
    programs.gpg = { package = pkgs.gnupg; expectSmartcard = false; };
    xdg.runtimeDir = "/tmp";
    home.homeDirectory = "/tmp";
  };
in (import ./modules/home/mail/sync.nix {
  inherit pkgs;
  lib = pkgs.lib;
  config = dummyConfig;
  maildir = "/tmp/mail-sync-tests";
  stampFile = "/tmp/mail-sync-tests/stamp";
  statusFile = "/tmp/mail-sync-tests/status.json";
}).mailTrayScript
EOF
)

tray_path=$(nix build --no-link --print-out-paths --impure --expr "$tray_expr")

workdir=$(mktemp -d /tmp/mail-tray-e2e.XXXXXX)
trap 'rm -rf "$workdir"' EXIT

export PYSTRAY_BACKEND=dummy
export MAIL_SYNC_STATUS_FILE="$workdir/status.json"
export MAIL_SYNC_STAMP_FILE="$workdir/stamp"
export MAIL_SYNC_MAILDIR="$workdir/maildir"
export MAIL_SYNC_INTERVAL="10m"
export MAIL_TRAY_DUMMY_EXIT=1

mkdir -p "$MAIL_SYNC_MAILDIR"

timeout 5 "$tray_path/bin/mail-tray"
echo "mail-tray e2e: started and exited cleanly with dummy backend"
