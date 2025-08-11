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

  # Wired using https://nixos-unified.org/autowiring.html
  outputs = inputs:
    inputs.nixos-unified.lib.mkFlake
      { inherit inputs; root = ./.; };

  # outputs = inputs@{ self, ... }:
  #   inputs.flake-parts.lib.mkFlake { inherit inputs; } {
  #     systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
  #     imports = (with builtins;
  #       map
  #         (fn: ./modules/flake-parts/${fn})
  #         (attrNames (readDir ./modules/flake-parts)));

  #     flake = {
  #       templates = {
  #         python-basic = {
  #           path = ./templates/python-basic;
  #           description = "Modern Python development environment with uv, testing, and code quality tools";
  #         };
  #         scala-basic = {
  #           path = ./templates/scala-basic;
  #           description = "Modern Scala development environment with sbt, testing, and code quality tools";
  #         };
  #         guile-basic = {
  #           path = ./templates/guile-basic;
  #           description = "Modern Guile (GNU Scheme) development environment with guild, testing, and REPL tools";
  #         };
  #         guile-hall = {
  #           path = ./templates/guile-hall;
  #           description = "Professional Guile development environment with guile-hall project management";
  #         };
  #         python-basic-devenv = {
  #           path = ./templates-devenv/python-basic;
  #           description = "Modern Python development environment with devenv, uv, testing, and code quality tools";
  #         };
  #         scala-basic-devenv = {
  #           path = ./templates-devenv/scala-basic;
  #           description = "Modern Scala development environment with devenv, sbt, testing, and code quality tools";
  #         };
  #         guile-basic-devenv = {
  #           path = ./templates-devenv/guile-basic;
  #           description = "Modern Guile (GNU Scheme) development environment with devenv, guild, testing, and REPL tools";
  #         };
  #         guile-hall-devenv = {
  #           path = ./templates-devenv/guile-hall;
  #           description = "Professional Guile development environment with devenv and guile-hall project management";
  #         };
  #       };
  #     };

  #     perSystem = { lib, system, config, ... }:
  #       let
  #         pkgs = import inputs.nixpkgs {
  #           inherit system;
  #           overlays = lib.attrValues self.overlays;
  #           config.allowUnfree = true;
  #         };
  #       in
  #       {
  #         # "Flake parts does not yet come with an endorsed module that initializes the pkgs argument."
  #         # So we must do this manually; https://flake.parts/overlays#consuming-an-overlay
  #         _module.args.pkgs = pkgs;
  #         # Expose templateUtils at the flake level
  #         checks = lib.optionalAttrs (system == "aarch64-darwin")
  #           {
  #             linux-builder = self.nixosConfigurations.linux-builder.config.system.build.toplevel;
  #           } // {
  #           # formatting = config.treefmt.build.check;
  #           templates = import ./tests/test-templates.nix {
  #             inherit pkgs lib;
  #           };
  #         };
  #       };
  #   };
}
