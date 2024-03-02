{ self, config, ... }:
{
  # Configuration common to all macOS systems
  flake = {
    darwinModules = {
      my-home = {
        home-manager.users.${config.people.myself} = { pkgs, ... }: {
          imports = [
            self.homeModules.common-darwin
          ];
        };
      };

      default.imports = [
        self.darwinModules_.home-manager
        self.darwinModules.my-home
        self.nixosModules.common
        ({ pkgs, ... }: {
          # Auto upgrade nix package and the daemon service.
          services.nix-daemon.enable = true;
        })
        ({ pkgs, ... }: {
          nixpkgs.overlays = [
            (import ./pkgs/overlay.nix)
            (let
              nivSources = let
                f = "${self}/nix-darwin/nivApps/sources.nix";
              in
                if builtins.pathExists f
                then import f
                else {};
              hm = pkgs.callPackage "${self.inputs.home-manager}/modules/files.nix" {
                lib = pkgs.lib // self.inputs.home-manager.lib;
              };
              hdiutil = hm.config.lib.file.mkOutOfStoreSymlink "/usr/bin/hdiutil";
            in (import ./niv-managed-dmg-apps.nix {
              inherit nivSources hdiutil;
            }))
            self.inputs.darwin-emacs.overlays.emacs
          ];
        })
        ./keyboard
        ./system-defaults.nix
        ./skhd
        ./sketchybar
      ];
    };
  };
}
