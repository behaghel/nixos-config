{ ... }:
let
  hostsDir = ../../configurations/openwrt;
  entries = builtins.readDir hostsDir;
  hostNames = builtins.filter (name: entries.${name} == "directory")
    (builtins.attrNames entries);
in
{
  flake.openwrtModules.default = ../openwrt;

  perSystem = { pkgs, lib, ... }:
    let
      hosts = lib.genAttrs hostNames (name:
        let
          cfg = (lib.evalModules {
            specialArgs = { inherit pkgs; };
            modules = [ ../openwrt (hostsDir + "/${name}") ];
          }).config;
        in
        assert lib.assertMsg (cfg.networking.hostName == name)
          "OpenWrt configuration directory must match its hostname";
        cfg);
      bootstrap = name: cfg: pkgs.writeShellApplication {
        name = "${name}-bootstrap";
        runtimeInputs = [ pkgs.coreutils ];
        # Print only: applying public-key bootstrap requires a trusted session.
        text = ''exec cat ${cfg.system.build.bootstrapScript}'';
      };
      packages = lib.mapAttrs bootstrap hosts;
    in
    {
      packages = lib.mapAttrs'
        (name: package:
          lib.nameValuePair "${name}-bootstrap" package)
        packages;
      apps = lib.mapAttrs'
        (name: package:
          lib.nameValuePair "${name}:bootstrap" {
            type = "app";
            program = lib.getExe package;
            meta.description = "Print native public-key bootstrap for ${name}; does not apply it";
          })
        packages;
      checks.openwrt = import ../../tests/openwrt.nix { inherit pkgs lib; };
    };
}
