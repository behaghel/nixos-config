{ inputs, ... }:

{
  perSystem = { pkgs, ... }: {
    apps.build-mele-hub-iso = {
      type = "app";
      program = pkgs.writeShellApplication {
        name = "build-mele-hub-iso";
        text = ''
          set -euo pipefail
          out_link="$PWD/result"
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
      ({ lib, pkgs, ... }: {
        myusers = lib.mkForce [];
        home-manager.users = lib.mkForce { };
        services.openssh.enable = true;
        users.users.root.openssh.authorizedKeys.keys = [ me.sshKey ];
        users.users.hub = {
          isNormalUser = true;
          openssh.authorizedKeys.keys = [ me.sshKey ];
        };

        # Headless monitoring defaults on the ISO.
        services.prometheus.exporters.node.enable = true;
        services.smartd.enable = true;

        # Console keyboard layout for the installer
        console.keyMap = "fr-bepo";

        # Helper script baked into the ISO to automate partitioning and mounts.
        environment.etc."install-mele-hub.sh" = {
          mode = "0755";
          source = ../../scripts/install-mele-hub.sh;
        };

        environment.systemPackages = [
          pkgs.gptfdisk
          pkgs.e2fsprogs
          pkgs.util-linux
        ];
      })
  ];
  specialArgs = { inherit flake; };
}).config.system.build.isoImage
EOF
          rm -f "$out_link"
          nix build --system x86_64-linux --impure --print-build-logs --option builders "$builders" --out-link "$out_link" --expr "$(cat "$tmp")"

          echo
          iso_path=""
          if iso_path=$(find "$out_link"/iso -maxdepth 1 -type f -name '*.iso' | head -n 1); then
            printf 'ISO built at: %s\n' "$iso_path"
          else
            echo "Built ISO, but could not locate iso/*.iso under $out_link" >&2
          fi

          guide_path="$PWD/docs/mele-syncthing-guide.md"
          echo
          if [ -f "$guide_path" ]; then
            printf 'Usage guide: %s\n' "$guide_path"
            echo "Quick copy to USB (Linux): sudo dd if=\"$iso_path\" of=/dev/sdX bs=4M status=progress oflag=sync"
          else
            echo "Usage guide not found in repo; expected at docs/mele-syncthing-guide.md"
          fi
        '';
      };
    };
  };
}
