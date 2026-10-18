{ inputs, ... }:
{
  flake.openwrtModules.default = ../openwrt;

  perSystem = { pkgs, lib, ... }:
    let
      hosts = import ../openwrt/hosts.nix { inherit pkgs lib; };
      bootstraps = lib.mapAttrs
        (name: cfg: pkgs.writeShellApplication {
          name = "${name}-bootstrap";
          runtimeInputs = [ pkgs.coreutils ];
          # Print only: applying public-key bootstrap requires a trusted session.
          text = ''exec cat ${cfg.system.build.bootstrapScript}'';
        })
        hosts;
      activations = lib.mapAttrs (_: cfg: cfg.system.build.activate) hosts;
      packageSet = suffix: packages: lib.mapAttrs'
        (name: package: lib.nameValuePair "${name}-${suffix}" package)
        packages;
      appSet = suffix: description: packages: lib.mapAttrs'
        (name: package: lib.nameValuePair "${name}:${suffix}" {
          type = "app";
          program = lib.getExe package;
          meta.description = "${description} ${name}";
        })
        packages;
    in
    {
      packages = packageSet "bootstrap" bootstraps // packageSet "activate" activations;
      apps = appSet "bootstrap" "Print native public-key bootstrap for" bootstraps
        // appSet "activate" "Check or apply native naming for" activations;
      checks.openwrt = import ../../tests/openwrt.nix { inherit pkgs lib inputs; };
    };
}
