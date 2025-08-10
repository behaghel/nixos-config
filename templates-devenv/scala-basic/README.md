
# Scala Basic Template (devenv)

A modern Scala project template with best practices and tooling for rapid development using devenv.

## Features

This template provides a complete development environment with:

- **⚡ Modern Scala tooling** - Scala 3 with `sbt` for build management
- **🔧 Development tools** - Scalafmt for formatting, Metals for IDE support
- **🧪 Testing framework** - ScalaTest for comprehensive testing
- **🏗️ Build system** - sbt with assembly plugin for fat JAR creation
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 devenv environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   devenv shell
   ```

2. **The project will auto-bootstrap** using `sbt new` on first visit

3. **Run tests**:
   ```bash
   devenv test
   ```

4. **Run the hello world example**:
   ```bash
   devenv shell run
   ```

## Development Lifecycle

### Core Commands

- **`devenv test`** - Run the full test suite with ScalaTest
- **`devenv shell dist`** - Build fat JAR for distribution
- **`devenv shell format`** - Format source code with Scalafmt
- **`devenv shell lint`** - Check code formatting with Scalafmt
- **`devenv shell repl`** - Start Scala REPL with project loaded
- **`devenv shell run`** - Run the main application
- **`devenv update`** - Update dependencies
- **`nix flake update`** - Update Nix development tools

### Example Workflows

```bash
# Start development (auto-bootstraps project)
devenv shell

# Run tests continuously during development
devenv test

# Run specific test class
sbt "testOnly scalabasic.MainSpec"

# Run the main application
devenv shell run

# Compile the project
sbt compile

# Start Scala REPL with project classpath
devenv shell repl

# Format code
devenv shell format

# Check formatting
devenv shell lint

# Create fat JAR
devenv shell dist

# Update dependencies
sbt update
```

## Project Structure

After auto-bootstrapping, your project will have:

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
├── devenv.nix                   # devenv development environment
├── build.sbt                    # Project configuration and dependencies
├── .scalafmt.conf               # Code formatting configuration
├── .envrc                       # Direnv configuration
├── .editorconfig                # Editor configuration
├── .gitignore                   # Git ignore rules
└── README.md                    # This file
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

This template uses devenv for reproducible development environments:

- **devenv** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **sbt** handles Scala compilation and dependency management
- **Auto-bootstrapping** creates project files using community best practices

## Configuration Files

- **`devenv.nix`** - devenv development environment specification
- **`build.sbt`** - Project metadata, dependencies, and build configuration (auto-generated)
- **`.scalafmt.conf`** - Code formatting rules for Scalafmt (auto-generated)
- **`.editorconfig`** - Editor settings for consistent formatting
- **`flake.nix`** - Nix flake configuration for devenv

## Getting Help

- Enter `devenv shell` to see available lifecycle commands in the shell prompt
- Use `devenv test`, `devenv shell format`, etc. for standard operations
- Check `build.sbt` for project configuration (after auto-bootstrap)
- Review `devenv.nix` for development environment setup
- Examine `src/test/` for testing examples (after auto-bootstrap)

## Emacs Configuration

For consistent Scala development using core Emacs functionality:

### Built-in Language Server (eglot)
```elisp
;; Scala development with eglot and Metals
(use-package eglot
  :hook (scala-mode . eglot-ensure)
  :config
  (add-to-list 'eglot-server-programs 
               '(scala-mode . ("metals"))))
```

### Formatting with built-in compile
```elisp
;; Format current buffer with scalafmt
(defun scala-format-buffer ()
  "Format current Scala buffer with scalafmt."
  (interactive)
  (when (eq major-mode 'scala-mode)
    (shell-command-on-region (point-min) (point-max) 
                             "scalafmt --stdin" 
                             (current-buffer) t)))

;; Bind to common formatting key
(define-key scala-mode-map (kbd "C-c f") #'scala-format-buffer)
```

### SBT Integration with built-in compile
```elisp
;; SBT compilation commands
(defun scala-sbt-compile ()
  "Compile Scala project with sbt."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt compile")))

(defun scala-sbt-test ()
  "Run sbt tests."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt test")))

(defun scala-sbt-run ()
  "Run Scala application with sbt."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt run")))

;; Key bindings
(define-key scala-mode-map (kbd "C-c c") #'scala-sbt-compile)
(define-key scala-mode-map (kbd "C-c t") #'scala-sbt-test)
(define-key scala-mode-map (kbd "C-c r") #'scala-sbt-run)
```

### REPL Integration with built-in inferior-process
```elisp
;; Scala REPL using sbt console
(defun scala-start-repl ()
  "Start Scala REPL using sbt console."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (run-scala "sbt console")))

(define-key scala-mode-map (kbd "C-c C-z") #'scala-start-repl)
```

## Customization

1. Update `build.sbt` with your project details and dependencies (after auto-bootstrap)
2. Modify the package structure in `src/main/scala/`
3. Add new test files in `src/test/scala/`
4. Customize `.scalafmt.conf` for formatting preferences
5. Extend the development environment in `devenv.nix` if needed

Happy coding! ⚡
