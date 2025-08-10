
# Devenv Project Templates

This directory contains standardized project templates for rapid development environment setup using [devenv](https://github.com/cachix/devenv).

## Usage

To use a template from this repository, run:

```bash
nix flake new <project-name> --template .#<template-name>-devenv
```

For example, to create a new Python project:

```bash
nix flake new my-python-project --template .#python-basic-devenv
```

After creating a project from a template:

1. Navigate to the new project directory
2. The development environment will automatically load if you have `direnv` installed
3. Run `devenv shell` to enter the environment manually if needed
4. Run standard lifecycle commands to manage your project
5. Start developing!

## Available Templates

| Template | Description | Key Features |
|----------|-------------|--------------|
| `python-basic-devenv` | Modern Python development environment | • Python 3.12 with `uv` package manager<br>• Black, Ruff, mypy, pytest for code quality<br>• Pre-commit hooks with automated formatting<br>• Hatchling build system<br>• Complete lifecycle commands (`build`, `test`, `package`, etc.) |
| `scala-basic-devenv` | Modern Scala development environment | • Scala 3 with `sbt` build tool<br>• Scalafmt for formatting, ScalaTest for testing<br>• Metals language server support<br>• Assembly plugin for fat JAR creation<br>• Complete lifecycle commands (`build`, `test`, `package`, etc.) |
| `guile-basic-devenv` | Modern Guile (GNU Scheme) development environment | • Guile 3.0 with module system support<br>• Guild compiler and linter for code quality<br>• SRFI-64 testing framework<br>• Interactive REPL development<br>• Complete lifecycle commands (`build`, `test`, `compile`, etc.) |
| `guile-hall-devenv` | Professional Guile development with guile-hall | • Guile 3.0 with guile-hall project management<br>• Autotools integration for professional builds<br>• Project scaffolding and metadata management<br>• Integrated testing and distribution<br>• Complete lifecycle commands (`build`, `test`, `dist`, etc.) |

## Template Standards

All templates in this directory follow these standards:

- **devenv-based** development environments for reproducible setups
- **Standardized lifecycle commands** using devenv scripts:
  - `devenv shell build` - Install dependencies and prepare project
  - `devenv shell check` - Run test suites
  - `devenv shell install` - Create distribution packages
  - Language-specific commands via devenv scripts
  - `devenv update` - Update dependencies
  - `nix flake update` - Update Nix development tools
- **Code quality tools** with formatting and linting
- **Pre-commit hooks** for automated quality checks
- **EditorConfig** for consistent coding style
- **direnv integration** for automatic environment loading
- **Comprehensive documentation** with examples

## Contributing

When adding new templates:

1. Follow the established directory structure
2. Include all standard lifecycle commands as devenv scripts
3. Provide comprehensive README documentation
4. Update this file's template table
5. Test the template with `nix flake new`
