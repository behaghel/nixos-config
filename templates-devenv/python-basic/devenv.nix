{ pkgs, lib, config, inputs, ... }:

{
  languages.python = {
    enable = true;
    version = "3.12";
    uv.enable = true;
  };

  packages = with pkgs; [
    # Development tools
    git
  ];

  scripts = {
    dist.exec = ''
      echo "📦 Building distribution packages..."
      uv build
      echo "✅ Packages built successfully!"
    '';

    format.exec = ''
      echo "🎨 Formatting code..."
      uv run black .
      uv run ruff check --fix .
      echo "✅ Code formatted!"
    '';

    lint.exec = ''
      echo "🔍 Linting code..."
      uv run ruff check .
      uv run mypy .
      echo "✅ Linting completed!"
    '';

    repl.exec = ''
      echo "🐍 Starting Python REPL..."
      uv run python "$@"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      uv run python -m python_basic.main "$@"
    '';
  };

  enterShell = ''
    # Initialize project if not already initialized
    if [ ! -f "pyproject.toml" ]; then
      echo "🚀 Bootstrapping new Python project..."

      # Copy template resources to project root
      if [ -d "template-resources" ]; then
        echo "📁 Copying template files..."
        cp -r template-resources/* .
        rm -rf template-resources
        echo "  ✓ Template files copied and template-resources cleaned up"
      fi

      echo "📦 Installing dependencies from pyproject.toml..."
      uv sync

      echo "🔧 Initializing Git repository..."
      git init
      git add .
      git commit -m "Initial commit from python-basic template"

      echo "✅ Project bootstrapped successfully!"
      echo ""
    fi

    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "${config.env.GREETING}"
    fi
  '';

  env = {
    GREETING = ''
🐍 Python Basic Development Environment
========================================

Available commands:
  devenv test           - Run test suite with pytest
  devenv shell run      - Run the main application
  devenv shell format   - Format code with Black and Ruff
  devenv shell lint     - Run linting with Ruff and mypy
  devenv shell dist     - Build distribution packages
  uv add <package>      - Add new dependencies
  uv lock --upgrade     - Update dependencies

Environment ready!'';
  };

  git-hooks = {
    enable = true;
    hooks = {
      black.enable = true;
      ruff.enable = true;
      mypy.enable = true;
    };
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    uv run pytest
    echo "✅ Tests completed!"
  '';
}