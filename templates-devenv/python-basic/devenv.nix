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
      # Use --lib flag for better project structure with src/ layout
      uv init --lib python-basic-project

      # Move project files to current directory
      if [ -d "python-basic-project" ]; then
        # Use cp to avoid overwrite issues, then remove source
        cp -r python-basic-project/* . 2>/dev/null || true
        cp -r python-basic-project/.* . 2>/dev/null || true
        rm -rf python-basic-project
      fi

      # Add development dependencies
      echo "📦 Installing development dependencies..."
      uv add --dev pytest black ruff mypy

      # Create sample test if it doesn't exist
      if [ ! -f "tests/test_main.py" ]; then
        mkdir -p tests
        cat > tests/test_main.py << 'EOF'
"""Tests for main module."""

import pytest
from python_basic.main import greet


def test_greet_default() -> None:
    """Test greet function with default parameter."""
    result = greet()
    assert result == "Hello, World!"


def test_greet_with_name() -> None:
    """Test greet function with custom name."""
    result = greet("Alice")
    assert result == "Hello, Alice!"


@pytest.mark.parametrize("name,expected", [
    ("Bob", "Hello, Bob!"),
    ("", "Hello, !"),
    ("Python", "Hello, Python!"),
])
def test_greet_parametrized(name: str, expected: str) -> None:
    """Test greet function with various inputs."""
    result = greet(name)
    assert result == expected
EOF
        
        cat > tests/__init__.py << 'EOF'
"""Test package."""
EOF
        echo "  ✓ Added sample pytest tests with parametrized examples"
      fi

      echo "✅ Python project bootstrapped with dependencies!"
      echo ""
    fi

    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "$GREETING"
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