
# Nix Project Templates

This directory contains standardized project templates for rapid development environment setup using Nix flakes.

## Usage

To use a template from this repository, run:

```bash
nix flake new <project-name> --template .#<template-name>
```

For example, to create a new Python project:

```bash
nix flake new my-python-project --template .#python-basic
```

After creating a project from a template:

1. Navigate to the new project directory
2. The development environment will automatically load if you have `direnv` installed
3. Run `build` to set up the project
4. Start developing!

## Available Templates

| Template | Description | Key Features |
|----------|-------------|--------------|
| `python-basic` | Modern Python development environment | • Python 3.12 with `uv` package manager<br>• Black, Ruff, mypy, pytest for code quality<br>• Pre-commit hooks with automated formatting<br>• Hatchling build system<br>• Complete lifecycle commands (`build`, `test`, `package`, etc.) |

## Template Standards

All templates in this repository follow these standards:

- **Nix flake-based** development environments for reproducibility
- **Standardized lifecycle commands**:
  - `build` - Compile/prepare the project
  - `test` - Run test suites
  - `package` - Create distribution packages
  - `run <target>` - Execute project tasks
  - `update` - Update dependencies
  - `update-env` - Update Nix development tools
- **Code quality tools** with formatting and linting
- **Pre-commit hooks** for automated quality checks
- **EditorConfig** for consistent coding style
- **direnv integration** for automatic environment loading
- **Comprehensive documentation** with examples

## Contributing

When adding new templates:

1. Follow the established directory structure
2. Include all standard lifecycle commands
3. Provide comprehensive README documentation
4. Update this file's template table
5. Test the template with `nix flake new`
