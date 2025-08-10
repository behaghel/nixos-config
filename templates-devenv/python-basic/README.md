
# Python Basic Template (devenv)

A modern Python project template with best practices and tooling for rapid development using [devenv](https://github.com/cachix/devenv).

## Features

This template provides a complete development environment with:

- **🚀 Modern Python tooling** - Python 3.12 with `uv` for fast package management
- **🔧 Development tools** - Black, Ruff, mypy, pytest for code quality
- **🏗️ Build system** - Hatchling for packaging
- **🪝 Pre-commit hooks** - Automated formatting and testing
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 devenv environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   devenv shell
   ```

2. **Build the project** (install dependencies and setup hooks):
   ```bash
   devenv shell build
   ```

3. **Run tests**:
   ```bash
   devenv shell check
   ```

4. **Run the hello world example**:
   ```bash
   devenv shell run
   ```

## Development Lifecycle

### Core Commands

- **`devenv shell build`** - Install dependencies and prepare the project for development
- **`devenv shell check`** - Run the full test suite with pytest
- **`devenv shell install`** - Build distribution packages (wheel and source)
- **`devenv shell run`** - Execute the main application
- **`devenv shell format`** - Format code with Black and Ruff
- **`devenv shell lint`** - Run linting with Ruff and mypy
- **`uv add <package>`** - Add new dependencies
- **`uv lock --upgrade`** - Update Python dependencies to latest compatible versions
- **`devenv update`** - Update devenv configuration
- **`nix flake update`** - Update Nix flake inputs (development tools)

### Example Workflows

```bash
# Start development
devenv shell build

# Run tests continuously during development
devenv shell check

# Run specific test file
uv run pytest tests/test_main.py

# Run the main application
devenv shell run

# Add new dependencies
uv add requests
uv add --dev pytest-cov  # Development dependency

# Update dependencies
uv lock --upgrade

# Build packages for distribution
devenv shell install

# Format and lint code
devenv shell format
devenv shell lint
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
├── devenv.nix               # devenv configuration
├── devenv.yaml              # devenv inputs
├── flake.nix                # Nix flake for devenv
├── pyproject.toml           # Python project configuration
├── .envrc                   # Direnv configuration
├── .editorconfig           # Editor configuration
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

This template uses devenv for reproducible development environments:

- **devenv** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **uv** handles Python package management efficiently

## Configuration Files

- **`devenv.nix`** - devenv development environment specification
- **`pyproject.toml`** - Python project metadata and tool configuration
- **`.editorconfig`** - Editor settings for consistent formatting
- **`flake.nix`** - Nix flake configuration for devenv

## Getting Help

- Enter `devenv shell` to see available lifecycle commands in the shell prompt
- Use `devenv shell build`, `check`, and `install` for standard operations
- Check `pyproject.toml` for project configuration
- Review `devenv.nix` for development environment setup
- Examine `tests/` for testing examples

## Customization

1. Update `pyproject.toml` with your project details
2. Modify dependencies in the `[project]` section
3. Add new modules in `src/python_basic/`
4. Write tests in `tests/` using pytest
5. Customize `devenv.nix` for additional tools or configuration
