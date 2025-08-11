{ pkgs, lib, config, inputs, ... }:

{
  languages.python = {
    enable = true;
    version = "3.12";
    uv.enable = true;
  };

  packages = with pkgs; [
    # Development tools
    black
    ruff
    mypy
    pytest
    pre-commit
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
    # Auto-bootstrap Python project if needed
    if [ ! -f "pyproject.toml" ]; then
      echo "🚀 Bootstrapping new Python project..."
      uv init python-basic-project
      echo "✅ Python project bootstrapped!"
      echo ""
    fi

    # Only show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "🐍 Python Basic Development Environment"
      echo "========================================"
      echo ""
      echo "Available commands:"
      echo "  devenv test           - Run test suite with pytest"
      echo "  devenv shell run      - Run the main application"
      echo "  devenv shell format   - Format code with Black and Ruff"
      echo "  devenv shell lint     - Run linting with Ruff and mypy"
      echo "  devenv shell dist     - Build distribution packages"
      echo "  uv add <package>      - Add new dependencies"
      echo "  uv lock --upgrade     - Update dependencies"
      echo ""
      echo "Environment ready!"
    fi
  '';

  pre-commit = {
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