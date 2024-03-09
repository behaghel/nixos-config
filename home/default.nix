{ self, ... }:
{
  flake = {
    homeModules = {
      common = {
        home.stateVersion = "23.11";
        imports = [
          ./shell
          ./zsh
          # ./starship.nix
          ./git
          # ./dropbox
          # ./emacs.nix
          ./mail
        ];
      };
      common-linux = {
        imports = [
          self.homeModules.common
        ];
      };
      common-darwin = {
        imports = [
          self.homeModules.common
          # ./kitty.nix
          ./nix-darwin/bepo.nix
          ./nix-darwin/niv-apps.nix
        ];
      };
    };
  };
}
