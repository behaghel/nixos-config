{
  inputs = {
    # main inputs (updated by `nix run .#update`)
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    nix-darwin.url = "github:LnL7/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    nixos-hardware.url = "github:NixOS/nixos-hardware";
    nixos-unified.url = "github:srid/nixos-unified";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    nuenv.url = "github:hallettj/nuenv/writeShellApplication";

    # nur.url = "github:nix-community/NUR";
    nix-index-database.url = "github:nix-community/nix-index-database";
    omnix.url = "github:juspay/omnix";

    emacs = {
      url = "github:nix-community/emacs-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Devshell
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs = inputs@{ self, ... }:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      imports = (with builtins;
        map
          (fn: ./modules/flake-parts/${fn})
          (attrNames (readDir ./modules/flake-parts)));

      flake = {
        templates = {
          python-basic = {
            path = ./templates/python-basic;
            description = "Modern Python development environment with uv, testing, and code quality tools";
          };
        };
      };

      perSystem = { lib, system, config, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = lib.attrValues self.overlays;
            config.allowUnfree = true;
          };
        in
        {
          # Make our overlay available to the devShell
          # "Flake parts does not yet come with an endorsed module that initializes the pkgs argument."
          # So we must do this manually; https://flake.parts/overlays#consuming-an-overlay
          _module.args.pkgs = pkgs;

          apps = {
            # Python project commands via uv
            run = {
              type = "app";
              program = "${pkgs.writeShellScript "uv-run" ''
                exec ${pkgs.uv}/bin/uv run "$@"
              ''}";
            };

            test = {
              type = "app";
              program = "${pkgs.writeShellScript "uv-test" ''
                exec ${pkgs.uv}/bin/uv run pytest "$@"
              ''}";
            };

            build = {
              type = "app";
              program = "${pkgs.writeShellScript "uv-build" ''
                exec ${pkgs.uv}/bin/uv build "$@"
              ''}";
            };

            sync = {
              type = "app";
              program = "${pkgs.writeShellScript "uv-sync" ''
                exec ${pkgs.uv}/bin/uv sync "$@"
              ''}";
            };

            lock = {
              type = "app";
              program = "${pkgs.writeShellScript "uv-lock" ''
                exec ${pkgs.uv}/bin/uv lock "$@"
              ''}";
            };
          };

          checks = lib.optionalAttrs (system == "aarch64-darwin")
            {
              linux-builder = self.nixosConfigurations.linux-builder.config.system.build.toplevel;
            } // {
            # formatting = config.treefmt.build.check;
            templates = import ./tests/test-templates.nix {
              inherit pkgs lib;
            };
          };
        };
    };
}