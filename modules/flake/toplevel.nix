# Top-level flake glue to get our configuration working
{ inputs, ... }:

{
  imports = [
    inputs.nixos-unified.flakeModules.default
    inputs.nixos-unified.flakeModules.autoWire
  ];
  perSystem = { self', pkgs, lib, ... }: {
    # For 'nix fmt'
    formatter = pkgs.nixpkgs-fmt;

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
