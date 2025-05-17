{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  nixpkgs.overlays = [
    (let
      nivSources = let
        f = "${self}/modules/darwin/nivApps/sources.nix";
      in
        if builtins.pathExists f
        then import f
        else {};
      hm = pkgs.callPackage "${self.inputs."home-manager"}/modules/files.nix" {
        lib = lib // self.inputs."home-manager".lib;
      };
      hdiutil = hm.config.lib.file.mkOutOfStoreSymlink "/usr/bin/hdiutil";
    in (import ./niv-managed-dmg-apps.nix {
      inherit nivSources hdiutil;
    }))
  ];
}
