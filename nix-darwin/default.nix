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
