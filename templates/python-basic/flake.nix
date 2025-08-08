{
  description = "Python development environment with uv";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    template-utils.url = "github:behaghel/nixos-config#lib.templateUtils";
  };

  outputs = { self, nixpkgs, template-utils }:
    {
      perSystem = { system, ... }:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          apps = {
            run = template-utils.mkApp "${pkgs.uv}/bin/uv run \"$@\"" pkgs;
            test = template-utils.mkApp "${pkgs.uv}/bin/uv run pytest \"$@\"" pkgs;
            build = template-utils.mkApp "${pkgs.uv}/bin/uv build \"$@\"" pkgs;
            sync = template-utils.mkApp "${pkgs.uv}/bin/uv sync \"$@\"" pkgs;
            lock = template-utils.mkApp "${pkgs.uv}/bin/uv lock \"$@\"" pkgs;
          };

          devShells.default = template-utils.mkDevShell
            {
              language = "Python";

              buildTools = with pkgs; [
                python312
                uv
              ];

              devTools = with pkgs; [
                ruff
                black
                mypy
                python312Packages.pytest
                pre-commit
              ];

              phases = {
                build = ''
                  echo "🔧 Installing dependencies and setting up project..."
                  uv sync
                  uv run pre-commit install
                  echo "✅ Project setup complete!"
                '';
                check = ''
                  echo "🧪 Running test suite..."
                  uv run pytest
                  echo "✅ Tests completed!"
                '';
                install = ''
                  echo "📦 Building distribution packages..."
                  uv build
                  echo "✅ Packages built successfully!"
                '';
              };

              shellHookCommands = [
                "uv run <command>       - Execute commands in project environment"
                "uv lock --upgrade      - Update dependencies"
                "nix flake update       - Update nix development environment"
              ];

              extraShellHook = ''
                # Initialize uv project if not already done
                if [ ! -f "pyproject.toml" ]; then
                  echo "Initializing uv project..."
                  uv init --no-readme
                fi
              '';
            }
            pkgs;
        };
    };
}
