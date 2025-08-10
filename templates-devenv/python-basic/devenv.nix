
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
    build.exec = ''
      echo "🔧 Setting up Python project..."
      uv sync --dev
      pre-commit install
      echo "✅ Project setup complete!"
    '';

    check.exec = ''
      echo "🧪 Running test suite..."
      uv run pytest
      echo "✅ Tests completed!"
    '';

    install.exec = ''
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

    run.exec = ''
      echo "🚀 Running application..."
      uv run python -m python_basic.main "$@"
    '';
  };

  enterShell = ''
    echo "🐍 Python Development Environment"
    echo "=================================="
    echo ""
    echo "Standard devenv commands:"
    echo "  devenv shell build    - Install dependencies and setup project"
    echo "  devenv shell check    - Run test suite"
    echo "  devenv shell install  - Build distribution packages"
    echo ""
    echo "Development commands:"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell format   - Format code with Black and Ruff"
    echo "  devenv shell lint     - Run linting with Ruff and mypy"
    echo ""
    echo "Package management:"
    echo "  uv add <package>      - Add new dependency"
    echo "  uv add --dev <pkg>    - Add development dependency"
    echo "  uv lock --upgrade     - Update dependencies"
    echo ""
    echo "Environment ready! Run 'devenv shell build' to get started."
  '';

  pre-commit = {
    enable = true;
    hooks = {
      black.enable = true;
      ruff.enable = true;
      mypy.enable = true;
    };
  };
}
