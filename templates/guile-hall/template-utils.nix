
{ nixpkgs }:

let
  # Helper function to generate a complete flake output for a template
  mkTemplate = templateConfig: inputs:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = templateConfig.buildTools ++ templateConfig.devTools ++ (with pkgs; [ git ]);

            buildPhase = templateConfig.phases.build;
            checkPhase = templateConfig.phases.check;
            installPhase = templateConfig.phases.install;

            shellHook = ''
              echo "${templateConfig.icon} ${templateConfig.language} Development Environment"
              echo "=================================="
              echo ""
              echo "Standard Nix commands:"
              echo "  nix develop --build    - Install dependencies and setup project"
              echo "  nix develop --check    - Run test suite"
              echo "  nix develop --install  - Build distribution packages"
              echo ""
              ${templateConfig.extraShellHook or ""}
              echo "Environment ready! Run 'nix develop --build' to get started."
            '';

            enablePhases = [ "check" "build" "install" ];
          };
        });

      apps = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        nixpkgs.lib.mapAttrs (name: command: {
          type = "app";
          program = "${pkgs.writeShellScript "${name}-script" ''
            exec ${command}
          ''}";
        }) templateConfig.apps);
    };
in
{
  inherit mkTemplate;
}
