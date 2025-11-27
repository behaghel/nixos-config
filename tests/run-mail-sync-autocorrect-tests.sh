#!/usr/bin/env bash
set -euo pipefail

root_dir=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root_dir"

system=$(nix eval --impure --raw --expr 'builtins.currentSystem')

auto_expr=$(cat <<EOF
let
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
in import ./modules/home/mail/autocorrect-script.nix {
  inherit pkgs;
}
EOF
)

autopath=$(nix build --no-link --print-out-paths --impure --expr "$auto_expr")
export MAIL_SYNC_AUTOCORRECT_BIN="$autopath/bin/mail-sync-autocorrect"

run_expr=$(cat <<EOF
let
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
  dummyConfig = {
    programs.gpg = {
      package = pkgs.gnupg;
      expectSmartcard = false;
    };
    xdg.runtimeDir = "/tmp";
    home.homeDirectory = "/tmp";
  };
in (import ./modules/home/mail/sync.nix {
  inherit pkgs;
  lib = pkgs.lib;
  config = dummyConfig;
  maildir = "/tmp/mail-sync-tests";
  stampFile = "/tmp/mail-sync-tests/stamp";
}).mailSyncScript
EOF
)

runpath=$(nix build --no-link --print-out-paths --impure --expr "$run_expr")
export MAIL_SYNC_RUN_BIN="$runpath/bin/mail-sync-run"

exec bats "$@" tests/mail-sync-autocorrect.bats
