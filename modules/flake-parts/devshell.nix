{ inputs, ... }:
{
  imports = [
    inputs.treefmt-nix.flakeModule
  ];
  perSystem = { inputs', config, pkgs, ... }: {
    devShells.default = pkgs.mkShell {
      name = "nixos-config-shell";
      meta.description = "Dev environment for nixos-config";
      inputsFrom = [ config.treefmt.build.devShell ];
      packages = with pkgs; [
        just
        colmena
        nixd
      ];
    };

    treefmt.config = {
      projectRootFile = "flake.nix";
      programs.alejandra.enable = true;
    };

    checks.formatting = config.treefmt.build.check;
  };
}
