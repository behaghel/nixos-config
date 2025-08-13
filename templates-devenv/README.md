
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
- **Template resources pattern** for bootstrapping project files

### Template Resources Pattern

Templates use a `template-resources/` directory to store pre-written files that are copied during project bootstrapping. This pattern provides:

- **Consistent file structure** - Files in `template-resources/` maintain the same relative path as their final destination
- **Reduced inline code** - Complex file contents are stored as separate files rather than embedded in shell scripts
- **Better maintainability** - Template files can be edited independently and tested separately
- **Automatic cleanup** - The `template-resources/` directory is removed after bootstrapping

#### Implementation

During the `enterShell` phase, templates:
1. Check if key project files exist (indicating an already bootstrapped project)
2. If not bootstrapped, copy files from `template-resources/` to their target locations
3. Remove the `template-resources/` directory after copying
4. Perform any additional setup (dependency installation, etc.)

### Subdirectory Bootstrap Pattern

Some project initialization tools create a subdirectory that needs to be moved to the project root. This pattern is common in tools like:
- **guile-hall** - Creates a `project-name/` subdirectory with project files
- **Python cookiecutter-style tools** - Often create nested project directories

The `template-utils.nix` provides `moveSubdirectoryToRoot` function to handle this:

```nix
extraBootstrapSteps = ''
  # Tool creates subdirectory with project files
  some-init-tool create my-project
  
  # Move all contents to root and clean up
  ${templateUtils.moveSubdirectoryToRoot "my-project"}
  
  # Continue with other setup...
'';
```

This function safely copies both regular and hidden files, then removes the subdirectory.

Example structure:
```
template-name/
├── devenv.nix
├── template-resources/
│   ├── src/
│   │   └── main.py          # Copied to ./src/main.py
│   ├── tests/
│   │   └── test_main.py     # Copied to ./tests/test_main.py
│   └── pyproject.toml       # Copied to ./pyproject.toml
└── ...
```

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
