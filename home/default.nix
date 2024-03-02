{ self, inputs, ... }:
{
  flake = {
    homeModules = {
      common = {
        home.stateVersion = "22.11";
        imports = [
          ./shell
          ./zsh
          # ./starship.nix
          ./git
          ./dropbox
          ./zsh
          ./emacs.nix
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
        ];
      };
    };
  };
}
