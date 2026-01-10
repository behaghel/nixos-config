{
  inputs = {
    # main inputs (updated by `nix run .#update`)
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-25.11-darwin";

    flake-parts.url = "github:hercules-ci/flake-parts";
    nix-darwin.url = "github:LnL7/nix-darwin/nix-darwin-25.11";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager/release-25.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    nixos-hardware.url = "github:NixOS/nixos-hardware";
    nixos-unified.url = "github:srid/nixos-unified";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    nuenv.url = "github:hallettj/nuenv/writeShellApplication";
    nuenv.inputs.nixpkgs.follows = "nixpkgs";

    # nur.url = "github:nix-community/NUR";
    nix-index-database.url = "github:nix-community/nix-index-database";
    nix-index-database.inputs.nixpkgs.follows = "nixpkgs";
    omnix.url = "github:juspay/omnix";
    omnix.inputs.nixpkgs.follows = "nixpkgs";

    emacs = {
      url = "github:nix-community/emacs-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Devshell
    treefmt-nix.url = "github:numtide/treefmt-nix";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  # Wired using https://nixos-unified.org/autowiring.html
  outputs = inputs:
    inputs.nixos-unified.lib.mkFlake
      { inherit inputs; root = ./.; };

}
