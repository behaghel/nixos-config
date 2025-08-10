
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
3. The project will be automatically bootstrapped using community best practices on first visit
4. Start developing!

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
- **Essential lifecycle commands** using devenv:
  - `devenv test` - Run test suites
  - `devenv shell dist` - Create distribution packages
  - `devenv shell format` - Format source code
  - `devenv shell lint` - Lint source code
  - `devenv shell repl` - Start language REPL with project loaded
  - `devenv update` - Update dependencies
  - `nix flake update` - Update Nix development tools
- **Code quality tools** with formatting and linting
- **Pre-commit hooks** for automated quality checks
- **EditorConfig** for consistent coding style
- **direnv integration** for automatic environment loading
- **Core Emacs compatibility** - All configurations prioritize built-in Emacs functionality
- **Comprehensive documentation** with examples

## Core Emacs Configuration

All templates are designed to work seamlessly with core Emacs functionality. The following base configuration supports all templates:

### Essential Setup
```elisp
;; Enable direnv integration
(use-package direnv
  :config
  (direnv-mode))

;; Project management with built-in project.el
(use-package project
  :bind (("C-x p f" . project-find-file)
         ("C-x p s" . project-shell)
         ("C-x p d" . project-dired)))

;; Language Server Protocol with built-in eglot
(use-package eglot
  :hook ((python-mode . eglot-ensure)
         (scala-mode . eglot-ensure)
         (scheme-mode . eglot-ensure))
  :config
  (setq eglot-events-buffer-size 0))

;; Geiser for Scheme-compatible languages (Guile, etc.)
(use-package geiser
  :hook (scheme-mode . geiser-mode))

(use-package geiser-guile
  :config
  (setq geiser-guile-load-path '(".")))

;; Built-in compilation mode for linting and testing
(setq compilation-scroll-output t)
```

### EditorConfig Support
```elisp
;; Respect .editorconfig files
(use-package editorconfig
  :config
  (editorconfig-mode 1))
```

## Contributing

When adding new templates:

1. Follow the established directory structure
2. Include all standard lifecycle commands as devenv scripts
3. Provide comprehensive README documentation
4. Update this file's template table
5. Test the template with `nix flake new`
