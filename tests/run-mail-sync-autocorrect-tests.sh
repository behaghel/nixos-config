#!/usr/bin/env bash
set -euo pipefail

root_dir=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root_dir"

system=$(nix eval --impure --raw --expr 'builtins.currentSystem')

auto_expr=$(cat <<EOF
let
  flake = builtins.getFlake ("git+file://" + toString ./.);
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
  flake = builtins.getFlake ("git+file://" + toString ./.);
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
  statusFile = "/tmp/mail-sync-tests/status.json";
}).mailSyncScript
EOF
)

runpath=$(nix build --no-link --print-out-paths --impure --expr "$run_expr")
export MAIL_SYNC_RUN_BIN="$runpath/bin/mail-sync-run"

keychain_expr=$(cat <<EOF
let
  flake = builtins.getFlake ("git+file://" + toString ./.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
  artefacts = import ./modules/home/mail/keychain.nix {
    inherit pkgs;
    lib = pkgs.lib;
    account = "test-user";
    stateFile = "/tmp/pass-keychain-tests/state.json";
    entries = [
      "veriff/mail/client-id"
      "veriff/mail/refresh-token"
    ];
  };
in artefacts
EOF
)

reader_path=$(nix build --no-link --print-out-paths --impure --expr "($keychain_expr).reader")
sync_path=$(nix build --no-link --print-out-paths --impure --expr "($keychain_expr).sync")
export MAIL_KEYCHAIN_READER_BIN="$reader_path/bin/mail-keychain-pass"
export MAIL_KEYCHAIN_SYNC_BIN="$sync_path/bin/mail-keychain-pass-sync"
export PASS_KEYCHAIN_BIN="$(nix build --no-link --print-out-paths --impure --expr "
  let flake = builtins.getFlake ("git+file://" + toString ./.);
  in import ./modules/home/pass-keychain {
    pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
  }")/bin/pass-keychain"

# Exercise both platform branches with native executables and fake GPG.  The
# Linux fixture substitutes coreutils for util-linux; tests bypass file locking.
platform_expr=$(cat <<'EOF'
let
  flake = builtins.getFlake ("git+file://" + toString ./.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
  gpg = pkgs.symlinkJoin {
    name = "mail-sync-test-gpg";
    paths = [
      (pkgs.writeShellScriptBin "gpgconf" ''
        printf 'gpgconf %s\n' "$*" >>"$MAIL_SYNC_GPG_LOG"
      '')
      (pkgs.writeShellScriptBin "gpg-connect-agent" ''
        printf 'gpg-connect-agent %s\n' "$*" >>"$MAIL_SYNC_GPG_LOG"
        if [ "$1" = "scd serialno" ]; then
          [ "$MAIL_SYNC_TEST_CARD" = 1 ] || exit 1
          printf 'S SERIALNO synthetic\n'
        fi
      '')
    ];
  };
  makeSync = isDarwin: (import ./modules/home/mail/sync.nix {
    pkgs = pkgs // {
      stdenv = pkgs.stdenv // { inherit isDarwin; };
      util-linux = pkgs.coreutils;
    };
    lib = pkgs.lib;
    config = {
      programs.gpg = { package = gpg; expectSmartcard = true; };
      home.homeDirectory = "/tmp/mail-sync-platform-tests";
    };
    maildir = "/tmp/mail-sync-platform-tests/mail";
    stampFile = "/tmp/mail-sync-platform-tests/stamp";
    statusFile = "/tmp/mail-sync-platform-tests/status.json";
  }).mailSyncScript;
in { darwin = makeSync true; linux = makeSync false; inherit gpg; }
EOF
)
export MAIL_SYNC_DARWIN_BIN="$(nix build --no-link --print-out-paths --impure --expr "($platform_expr).darwin")/bin/mail-sync-run"
export MAIL_SYNC_LINUX_BIN="$(nix build --no-link --print-out-paths --impure --expr "($platform_expr).linux")/bin/mail-sync-run"
export MAIL_SYNC_TEST_GPG_DIR="$(nix build --no-link --print-out-paths --impure --expr "($platform_expr).gpg")/bin"

exec bats "$@" tests/mail-sync-autocorrect.bats tests/mail-keychain.bats tests/mail-sync-smartcard.bats
