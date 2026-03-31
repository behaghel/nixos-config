{ flake, pkgs, ... }:
let
  devenvPkg = flake.inputs.devenv.packages.${pkgs.stdenv.hostPlatform.system}.devenv;
in
{
  home.packages = [ devenvPkg ];
}
