
{ nixpkgs }:

let
  # Helper function to generate a complete flake output for a template
  mkTemplate = templateConfig:
    { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = (if builtins.isFunction templateConfig.buildTools 
                       then templateConfig.buildTools system 
                       else templateConfig.buildTools) ++
                      (if builtins.isFunction templateConfig.devTools
                       then templateConfig.devTools system
                       else templateConfig.devTools) ++ 
                      (with pkgs; [ git ]);

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
              ${if builtins.isFunction (templateConfig.extraShellHook or "") 
                then templateConfig.extraShellHook system 
                else (templateConfig.extraShellHook or "")}
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
