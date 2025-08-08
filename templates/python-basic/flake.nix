
{
  description = "Python development environment with uv";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        pythonEnv = pkgs.python312;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Python and uv
            pythonEnv
            uv
            
            # Development tools
            ruff
            black
            mypy
            pytest
            pre-commit
            
            # Build tools
            git
            just
          ];

          shellHook = ''
            echo "🐍 Python Development Environment"
            echo "=================================="
            echo ""
            echo "Available commands:"
            echo "  build      - Install dependencies and prepare project"
            echo "  test       - Run test suite with pytest"
            echo "  package    - Build distribution packages"
            echo "  run <task> - Execute project tasks"
            echo "  update     - Update dependencies"
            echo "  update-env - Update nix development environment"
            echo ""
            echo "Environment ready! Run 'build' to get started."
            
            # Initialize uv project if not already done
            if [ ! -f "pyproject.toml" ]; then
              echo "Initializing uv project..."
              uv init --no-readme
            fi
          '';

          # Shell aliases
          shellAliases = {
            build = "uv sync && uv run pre-commit install";
            test = "uv run pytest";
            package = "uv build";
            run = "uv run";
            update = "uv lock --upgrade";
            update-env = "nix flake update";
          };
        };
      });
}
