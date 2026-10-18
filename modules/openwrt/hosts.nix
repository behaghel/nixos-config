# Shared inventory for flake tools and managed SSH clients.
{ pkgs, lib }:
let
  directory = ../../configurations/openwrt;
  entries = builtins.readDir directory;
  names = builtins.filter (name: entries.${name} == "directory")
    (builtins.attrNames entries);
in
lib.genAttrs names (name:
let
  cfg = (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [ ./default.nix (directory + "/${name}") ];
  }).config;
in
assert lib.assertMsg (cfg.networking.hostName == name)
  "OpenWrt configuration directory must match its hostname";
cfg)
