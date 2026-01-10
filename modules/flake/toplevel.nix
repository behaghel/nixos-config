# Top-level flake glue to get our configuration working
{ inputs, ... }:

{
  imports = [
    inputs.nixos-unified.flakeModules.default
    inputs.nixos-unified.flakeModules.autoWire
  ];
  perSystem = { self', pkgs, ... }: {
    # For 'nix fmt'
    formatter = pkgs.nixpkgs-fmt;

    # Enables 'nix run' to activate.
    packages.default = self'.packages.activate;

    apps.build-mele-hub-iso = {
      type = "app";
      program = pkgs.writeShellApplication {
        name = "build-mele-hub-iso";
        text = ''
          set -euo pipefail
          echo "Building mele-hub ISO using configured remote builders (x86_64 + aarch64)…"
          # Keys live at repo_root/keys; resolve at runtime so we don't rely on them being in the flake source.
          keys_dir=''${KEYS_DIR:-"$PWD/keys"}
          builders="ssh-ng://root@builder-x86 x86_64-linux ''$keys_dir/utm-builder_ed25519 4 1 benchmark,big-parallel;ssh-ng://builder@builder-arm aarch64-linux ''$keys_dir/builder_ed25519 2 1 kvm,benchmark,big-parallel"
          tmp=$(mktemp)
          cat >"$tmp" <<'EOF'
let
  flakeSelf = builtins.getFlake (toString ./.);
  flake = flakeSelf // { inputs = flakeSelf.inputs // { self = flakeSelf; }; };
  nixpkgs = flake.inputs.nixpkgs;
  system = "x86_64-linux";
  me = (import ./config.nix).me;
  pkgs = import nixpkgs { inherit system; config.allowUnfree = true; overlays = import ./overlays/default.nix { inputs = flake.inputs; }; };
  evalConfig = import (nixpkgs.outPath + "/nixos/lib/eval-config.nix");
in
  (evalConfig {
    inherit system pkgs;
    modules = [
      ({ lib, ... }: { nixpkgs.config = lib.mkForce {}; })
      flake.inputs.home-manager.nixosModules.home-manager
      { home-manager = { useGlobalPkgs = true; useUserPackages = true; extraSpecialArgs = { inherit flake; }; }; }
      (nixpkgs.outPath + "/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix")
      ./configurations/nixos/mele-hub/default.nix
      ./configurations/nixos/mele-hub/hardware-configuration.nix
      # ISO-specific overrides: skip HM users, seed SSH keys.
      ({ lib, ... }: {
        myusers = lib.mkForce [];
        home-manager.users = lib.mkForce { };
        services.openssh.enable = true;
        users.users.root.openssh.authorizedKeys.keys = [ me.sshKey ];
        users.users.hub = {
          isNormalUser = true;
          openssh.authorizedKeys.keys = [ me.sshKey ];
        };
      })
  ];
  specialArgs = { inherit flake; };
}).config.system.build.isoImage
EOF
          nix build --system x86_64-linux --impure --print-build-logs --option builders "$builders" --expr "$(cat "$tmp")"
        '';
      };
    };

    checks.video-editing = import ../../tests/video-editing.nix { inherit pkgs; };

    # Flake inputs we want to update periodically
    # Run: `nix run .#update`.
    nixos-unified = {
      primary-inputs = [
        "nixpkgs"
        "home-manager"
        "nix-darwin"
        "nixos-unified"
        "nix-index-database"
        # "nixvim"
        "omnix"
      ];
    };
  };
}
