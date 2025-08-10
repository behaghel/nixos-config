
# Scala Basic Template

A modern Scala project template with best practices and tooling for rapid development.

## Features

This template provides a complete development environment with:

- **⚡ Modern Scala tooling** - Scala 3 with `sbt` for build management
- **🔧 Development tools** - Scalafmt for formatting, Metals for IDE support
- **🧪 Testing framework** - ScalaTest for comprehensive testing
- **🏗️ Build system** - sbt with assembly plugin for fat JAR creation
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 Nix environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   nix develop
   ```

2. **Build the project** (install dependencies and setup):
   ```bash
   nix develop --build
   ```

3. **Run tests**:
   ```bash
   nix develop --check
   ```

4. **Run the hello world example**:
   ```bash
   sbt run
   ```

## Development Lifecycle

### Core Commands

- **`nix develop --build`** - Install dependencies and prepare the project for development
- **`nix develop --check`** - Run the full test suite with ScalaTest
- **`nix develop --install`** - Build fat JAR for distribution
- **`sbt <command>`** - Execute sbt commands in the project environment
- **`nix flake update`** - Update Nix flake inputs (development tools)

### Example Workflows

```bash
# Start development
nix develop --build

# Run tests continuously during development
nix develop --check

# Run specific test class
sbt "testOnly scalabasic.MainSpec"

# Run the main application
sbt run

# Compile the project
sbt compile

# Start Scala REPL with project classpath
nix run .#repl

# Format code
nix run .#format

# Check formatting
nix run .#lint

# Create fat JAR
sbt assembly

# Update dependencies
sbt update
```

## Project Structure

```
.
├── src/
│   ├── main/scala/scalabasic/    # Source code
│   │   └── Main.scala            # Hello world example
│   └── test/scala/scalabasic/    # Test files
│       └── MainSpec.scala        # Example tests
├── project/                      # sbt configuration
│   ├── build.properties         # sbt version
│   └── plugins.sbt              # sbt plugins
├── flake.nix                    # Nix development environment
├── build.sbt                   # Project configuration and dependencies
├── .scalafmt.conf              # Code formatting configuration
├── .envrc                      # Direnv configuration
├── .editorconfig               # Editor configuration
├── .gitignore                  # Git ignore rules
└── README.md                   # This file
```

## Code Quality Tools

### Formatting
- **Scalafmt** - Opinionated code formatter with Scala 3 support

### Testing
- **ScalaTest** - Feature-rich testing framework with multiple testing styles

### IDE Support
- **Metals** - Language server for Scala development

### Build System
- **sbt** - Interactive build tool with incremental compilation
- **sbt-assembly** - Plugin for creating fat JARs

## Environment Management

This template uses Nix for reproducible development environments:

- **Nix flake** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **sbt** handles Scala compilation and dependency management

## Configuration Files

- **`build.sbt`** - Project metadata, dependencies, and build configuration
- **`.scalafmt.conf`** - Code formatting rules for Scalafmt
- **`.editorconfig`** - Editor settings for consistent formatting
- **`flake.nix`** - Nix development environment specification

## Getting Help

- Enter `nix develop` to see available lifecycle commands in the shell prompt
- Use `nix develop --build`, `--check`, and `--install` for standard operations
- Check `build.sbt` for project configuration
- Review `flake.nix` for development environment setup
- Examine `src/test/` for testing examples

## Emacs Configuration

To get consistent formatting and development experience in Emacs:

### Scala Mode and Formatting
```elisp
;; Scala development
(use-package scala-mode
  :ensure t
  :mode "\\.s\\(cala\\|bt\\)$")

;; Scalafmt integration
(use-package scalafmt
  :ensure t
  :hook (scala-mode . scalafmt-enable-on-save)
  :config
  (setq scalafmt-command "scalafmt"))
```

### Metals LSP Support
```elisp
;; Metals Language Server
(use-package lsp-metals
  :ensure t
  :hook (scala-mode . lsp-deferred)
  :config
  (setq lsp-metals-server-args '("-J-Dmetals.allow-multiline-string-formatting=off")))

;; SBT integration
(use-package sbt-mode
  :ensure t
  :commands sbt-start sbt-command
  :config
  (substitute-key-definition 'minibuffer-complete-word
                           'self-insert-command
                           minibuffer-local-completion-map))
```

### REPL Integration
```elisp
;; Enhanced Scala REPL
(use-package scala-repl
  :ensure t
  :hook (scala-mode . scala-repl-mode))
```

## Customization

1. Update `build.sbt` with your project details and dependencies
2. Modify the package structure in `src/main/scala/`
3. Add new test files in `src/test/scala/`
4. Configure Scalafmt rules in `.scalafmt.conf`
5. Extend the development environment in `flake.nix` if needed

Happy coding! ⚡
