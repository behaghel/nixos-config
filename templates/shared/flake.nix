
{
  description = "Shared utilities for project templates";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = nixpkgs.lib;
      in
      {
        lib = rec {
          # Standard phases configuration
          standardPhases = {
            enablePhases = [ "check" "build" "install" ];
          };

          # Common shell hook header
          mkShellHook = { name, icon, commands }: ''
            echo "${icon} ${name} Development Environment"
            echo "=================================="
            echo ""
            echo "Standard Nix commands:"
            echo "  nix develop --build    - Install dependencies and setup project"
            echo "  nix develop --check    - Run test suite"
            echo "  nix develop --install  - Build distribution packages"
            echo ""
            echo "Additional commands:"
            ${lib.concatStringsSep "\n    " (map (cmd: "echo \"  ${cmd}\"") commands)}
            echo ""
            echo "Environment ready! Run 'nix develop --build' to get started."
          '';

          # Standard app builder
          mkApp = command: {
            type = "app";
            program = "${pkgs.writeShellScript "app-script" ''
              exec ${command}
            ''}";
          };

          # Common development shell builder
          mkDevShell = { language, buildTools, devTools, phases, shellHookCommands, extraShellHook ? "" }:
            pkgs.mkShell ({
              packages = buildTools ++ devTools ++ (with pkgs; [ git just ]);

              buildPhase = phases.build;
              checkPhase = phases.check;
              installPhase = phases.install;

              shellHook = mkShellHook {
                name = language;
                icon = {
                  Python = "🐍";
                  Scala = "⚡";
                  Guile = "🐧";
                }.${language};
                commands = shellHookCommands;
              } + extraShellHook;
            } // standardPhases);
        };
      });
}
