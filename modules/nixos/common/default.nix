{ lib, ... }:
{
  imports = [
    ../../common/myusers.nix
  ];

  nix.settings = {
    substituters = lib.mkAfter [
      "https://devenv.cachix.org"
    ];
    trusted-public-keys = lib.mkAfter [
      "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw="
    ];
  };
}
