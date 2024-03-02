{
  inputs = {
    # Principle inputs (updated by `nix run .#update`)
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    nur.url = "github:nix-community/NUR";
    nix-darwin.url = "github:lnl7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    flake-parts.url = "github:hercules-ci/flake-parts";
    nixos-flake.url = "github:srid/nixos-flake";
    darwin-emacs = {
      url = "github:c4710n/nix-darwin-emacs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs@{ self, ... }:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      imports = [
        inputs.nixos-flake.flakeModule
        ./users
        ./home
        ./nixos
        ./nix-darwin
      ];

      flake =
        let
          # TODO: Change username
          myUserName = "hub";
        in
          {
            # Configurations for macOS machines
            darwinConfigurations = {
              tfmbp = self.nixos-flake.lib.mkMacosSystem ./machines/tfmbp.nix;
            };

            # Configurations for Linux (NixOS) machines
            nixosConfigurations = {
              linux-builder = self.nixos-flake.lib.mkLinuxSystem
                ./systems/linux-builder.nix;
              # nixosBase = self.nixos-flake.lib.mkLinuxSystem {
              #   nixpkgs.hostPlatform = "x86_64-linux";
              #   imports = [
              #     self.nixosModules.common # See below for "nixosModules"!
              #     self.nixosModules.linux
              #     # Your machine's configuration.nix goes here
              #     ({ pkgs, ... }: {
              #       # TODO: Put your /etc/nixos/hardware-configuration.nix here
              #       boot.loader.grub.device = "nodev";
              #       fileSystems."/" = {
              #         device = "/dev/disk/by-label/nixos";
              #         fsType = "btrfs";
              #       };
              #       system.stateVersion = "23.05";
              #     })
              #     # Your home-manager configuration
              #     self.nixosModules.home-manager
              #     {
              #       home-manager.users.${myUserName} = {
              #         imports = [
              #           self.homeModules.common # See below for "homeModules"!
              #           self.homeModules.linux
              #         ];
              #         home.stateVersion = "22.11";
              #       };
              #     }
              #   ];
              # };
            };
          };

      perSystem = { self', system, pkgs, lib, config, inputs', ... }: {
        # Flake inputs we want to update periodically
        # Run: `nix run .#update`.
        nixos-flake.primary-inputs = [
          "nixpkgs"
          "home-manager"
          "nix-darwin"
          "nixos-flake"
          "darwin-emacs"
        ];
        packages.default = self'.packages.activate;
        devShells.default = pkgs.mkShell {
          # inputsFrom = [ config.treefmt.build.devShell ];
          packages = [
            pkgs.sops
            pkgs.ssh-to-age
            pkgs.nixos-rebuild
            pkgs.just
          ];
        };
      };

    };
}
