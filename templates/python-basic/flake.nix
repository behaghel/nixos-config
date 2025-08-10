{
  description = "Python development environment with uv";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ self, nixpkgs }:
    let
      templateUtils = import ./template-utils.nix { inherit nixpkgs; };

      pythonConfig = {
        language = "Python";
        icon = "🐍";

        buildTools = with nixpkgs.legacyPackages.x86_64-linux; [
          python312
          uv
        ];

        devTools = with nixpkgs.legacyPackages.x86_64-linux; [
          ruff
          black
          mypy
          python312Packages.pytest
          pre-commit
        ];

        apps = {
          run = "uv run python -m python_basic.main \"$@\"";
          test = "uv run pytest \"$@\"";
          build = "uv build \"$@\"";
          format = "uv run black . && uv run ruff check --fix . \"$@\"";
          lint = "uv run ruff check . && uv run mypy . \"$@\"";
          repl = "uv run python \"$@\"";
          clean = "rm -rf .pytest_cache/ .ruff_cache/ .mypy_cache/ dist/ \"$@\"";
        };

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

        extraShellHook = ''
          # Initialize uv project if not already done
          if [ ! -f "pyproject.toml" ]; then
            echo "Initializing uv project..."
            uv init --no-readme
          fi

          echo "Commands:"
          echo "  uv run <command>       - Execute commands in project environment"
          echo "  uv lock --upgrade      - Update dependencies"
          echo "  nix flake update       - Update nix development environment"
        '';
      };
    in
    templateUtils.mkTemplate pythonConfig inputs;
}