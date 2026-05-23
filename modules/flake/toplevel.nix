# Top-level flake glue to get our configuration working
{ inputs, ... }:

{
  imports = [
    inputs.nixos-unified.flakeModules.default
    inputs.nixos-unified.flakeModules.autoWire
  ];
  perSystem = { self', pkgs, lib, ... }: {
    # For 'nix fmt'. Filter explicitly so accidental `nix fmt foo.py`
    # cannot mangle non-Nix sources.
    formatter = pkgs.writeShellApplication {
      name = "nix-fmt-only";
      runtimeInputs = [ pkgs.findutils pkgs.nixpkgs-fmt ];
      text = ''
        set -euo pipefail

        nix_files=()
        if [ "$#" -eq 0 ]; then
          while IFS= read -r -d ''' path; do
            nix_files+=("$path")
          done < <(find . -type f -name '*.nix' \
            -not -path './.git/*' \
            -not -path './result/*' \
            -print0)
        else
          for arg in "$@"; do
            if [ -d "$arg" ]; then
              while IFS= read -r -d ''' path; do
                nix_files+=("$path")
              done < <(find "$arg" -type f -name '*.nix' -print0)
            elif [[ "$arg" == *.nix ]]; then
              nix_files+=("$arg")
            fi
          done
        fi

        if [ "''${#nix_files[@]}" -eq 0 ]; then
          echo "nix fmt: no .nix files to format"
          exit 0
        fi

        exec nixpkgs-fmt "''${nix_files[@]}"
      '';
    };

    # Enables 'nix run' to activate.
    packages.default = self'.packages.activate;

    checks.marketplace = import ../../tests/marketplace.nix { inherit pkgs lib; };
    checks.opencode-model-config-modes = import ../../tests/opencode-model-config-modes.nix { inherit pkgs lib inputs; };
    checks.opencode-context7 = import ../../tests/opencode-context7.nix { inherit pkgs lib inputs; };
    checks.pi-module = import ../../tests/pi-module.nix { inherit pkgs lib inputs; };

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
