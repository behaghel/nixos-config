
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
          run = "uv run \"$@\"";
          test = "uv run pytest \"$@\"";
          build = "uv build \"$@\"";
          sync = "uv sync \"$@\"";
          lock = "uv lock \"$@\"";
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
