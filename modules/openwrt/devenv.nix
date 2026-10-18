{ pkgs, lib, ... }:
let
  hosts = import ./hosts.nix { inherit pkgs lib; };
in
{
  scripts = lib.mapAttrs'
    (name: cfg: lib.nameValuePair "${name}:activate" {
      description = "Check or apply native OpenWrt naming and key-only SSH policy";
      exec = ''exec ${lib.getExe cfg.system.build.activate} "$@"'';
    })
    hosts;
}
