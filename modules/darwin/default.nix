# Configuration common to all macOS systems
{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs config;
  inherit (inputs) self;
in
{
  imports = [
    ../common/myusers.nix
    ./zsh-completion-fix.nix
    ./keyboard
    ./system-defaults.nix
    ./homebrew-apps.nix
    ./open-source-tailscale.nix
  ];

  config = {
    nixpkgs.overlays = import ../../overlays/default.nix { inherit inputs; };
    nix.settings = {
      substituters = lib.mkAfter [
        "https://emacs.cachix.org"
        "https://devenv.cachix.org"
      ];
      trusted-public-keys = lib.mkAfter [
        "emacs.cachix.org-1:TU3ITeTVpL41RDdfJnr3CGqoTrs1sCWlpPhPkG2EW7E="
        "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw="
      ];
    };
  };
}
