
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
          packages = with pkgs; [
            # Python and uv
            pythonEnv
            uv

            # Development tools
            ruff
            black
            mypy
            python312Packages.pytest
            pre-commit

            # Build tools
            git
            just
          ];

          # Standard Nix build phases for development
          buildPhase = ''
            echo "🔧 Installing dependencies and setting up project..."
            uv sync
            uv run pre-commit install
            echo "✅ Project setup complete!"
          '';

          checkPhase = ''
            echo "🧪 Running test suite..."
            uv run pytest
            echo "✅ Tests completed!"
          '';

          installPhase = ''
            echo "📦 Building distribution packages..."
            uv build
            echo "✅ Packages built successfully!"
          '';

          shellHook = ''
            echo "🐍 Python Development Environment"
            echo "=================================="
            echo ""
            echo "Standard Nix commands:"
            echo "  nix develop --build    - Install dependencies and setup project"
            echo "  nix develop --check    - Run test suite with pytest"
            echo "  nix develop --install  - Build distribution packages"
            echo ""
            echo "Additional commands:"
            echo "  uv run <command>       - Execute commands in project environment"
            echo "  uv lock --upgrade      - Update dependencies"
            echo "  nix flake update       - Update nix development environment"
            echo ""
            echo "Environment ready! Run 'nix develop --build' to get started."

            # Initialize uv project if not already done
            if [ ! -f "pyproject.toml" ]; then
              echo "Initializing uv project..."
              uv init --no-readme
            fi
          '';
        };
      });
}
