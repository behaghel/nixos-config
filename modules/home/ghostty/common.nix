{ pkgs, lib }:
let
  pkg = pkgs.ghostty;
  available =
    let t = builtins.tryEval (lib.meta.availableOn pkgs.stdenv.hostPlatform pkg);
    in t.success && t.value && !(pkg.meta.broken or false);
in
{
  ghosttyPkg = pkg;
  ghosttyAvailable = available;
}
