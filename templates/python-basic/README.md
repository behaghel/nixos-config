
# Python Basic Template

A modern Python project template with best practices and tooling for rapid development.

## Features

This template provides a complete development environment with:

- **🚀 Modern Python tooling** - Python 3.12 with `uv` for fast package management
- **🔧 Development tools** - Black, Ruff, mypy, pytest for code quality
- **🏗️ Build system** - Hatchling for packaging
- **🪝 Pre-commit hooks** - Automated formatting and testing
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 Nix environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   nix develop
   ```

2. **Build the project** (install dependencies and setup hooks):
   ```bash
   nix develop --build
   ```

3. **Run tests**:
   ```bash
   nix develop --check
   ```

4. **Run the hello world example**:
   ```bash
   uv run python -m python_basic.main
   ```

## Development Lifecycle

### Core Commands

- **`nix develop --build`** - Install dependencies and prepare the project for development
- **`nix develop --check`** - Run the full test suite with pytest
- **`nix develop --install`** - Build distribution packages (wheel and source)
- **`uv run <command>`** - Execute commands in the project environment
- **`uv lock --upgrade`** - Update Python dependencies to latest compatible versions
- **`nix flake update`** - Update Nix flake inputs (development tools)

### Example Workflows

```bash
# Start development
nix develop --build

# Run tests continuously during development
nix develop --check

# Run specific test file
uv run pytest tests/test_main.py

# Run the main application
uv run python -m python_basic.main

# Format code
nix run .#format

# Lint code
nix run .#lint

# Start Python REPL with project loaded
nix run .#repl

# Add new dependencies
uv add requests
uv add --dev pytest-cov  # Development dependency

# Update dependencies
uv lock --upgrade

# Build packages for distribution
nix develop --install
```

## Project Structure

```
.
├── src/python_basic/          # Source code
│   ├── __init__.py
│   └── main.py               # Hello world example
├── tests/                    # Test files
│   ├── __init__.py
│   └── test_main.py         # Example tests
├── flake.nix                # Nix development environment
├── pyproject.toml           # Python project configuration
├── .envrc                   # Direnv configuration
├── .editorconfig           # Editor configuration
├── .pre-commit-config.yaml # Pre-commit hooks
└── README.md               # This file
```

## Code Quality Tools

### Formatting
- **Black** - Opinionated code formatter
- **Ruff** - Fast Python linter and formatter

### Type Checking
- **mypy** - Static type checker

### Testing
- **pytest** - Testing framework with parametrized tests

### Pre-commit Hooks
The template includes pre-commit hooks that run automatically on each commit:
- Code formatting with Black and Ruff
- Type checking with mypy
- Test execution with pytest

## Environment Management

This template uses Nix for reproducible development environments:

- **Nix flake** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **uv** handles Python package management efficiently

## Configuration Files

- **`pyproject.toml`** - Python project metadata and tool configuration
- **`.editorconfig`** - Editor settings for consistent formatting
- **`.pre-commit-config.yaml`** - Pre-commit hook configuration
- **`flake.nix`** - Nix development environment specification

## Getting Help

- Enter `nix develop` to see available lifecycle commands in the shell prompt
- Use `nix develop --build`, `--check`, and `--install` for standard operations
- Check `pyproject.toml` for project configuration
- Review `flake.nix` for development environment setup
- Examine `tests/` for testing examples

## Emacs Configuration

To get consistent formatting and linting in Emacs that matches the project's tools:

### Formatting (Black + Ruff)
Add to your Emacs configuration:

```elisp
;; Python formatting with Black
(use-package blacken
  :ensure t
  :hook (python-mode . blacken-mode)
  :config
  (setq blacken-line-length 88))

;; Python linting with Ruff via flymake
(use-package flymake-ruff
  :ensure t
  :hook (python-mode . flymake-ruff-load))
```

### Type Checking (mypy)
```elisp
;; mypy integration
(use-package flycheck
  :ensure t
  :hook (python-mode . flycheck-mode)
  :config
  (flycheck-add-next-checker 'python-flake8 'python-mypy))
```

### LSP Support
For full IDE features, use `lsp-mode` or `eglot` with `pylsp`:

```elisp
(use-package lsp-mode
  :ensure t
  :hook (python-mode . lsp-deferred)
  :config
  (setq lsp-pylsp-plugins-black-enabled t
        lsp-pylsp-plugins-ruff-enabled t
        lsp-pylsp-plugins-mypy-enabled t))
```

## Customization

1. Update `pyproject.toml` with your project details
2. Modify dependencies in the `[project]` section
3. Add new modules in `src/python_basic/`
4. Write tests in `tests/`
5. Extend the development environment in `flake.nix` if needed

Happy coding! 🐍
