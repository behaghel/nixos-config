# Guile Basic Template (devenv)

A modern Guile (GNU Scheme) project template with best practices and tooling for rapid development using [devenv](https://github.com/cachix/devenv).

## Features

This template provides a complete development environment with:

- **🐧 Modern Guile tooling** - Guile 3.0 with module system support
- **🔧 Development tools** - Guild compiler, linter, and REPL
- **🧪 Testing framework** - SRFI-64 for comprehensive testing
- **🏗️ Build system** - Guild compilation for bytecode generation
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 devenv environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   devenv shell
   ```

2. **Run tests**:
   ```bash
   devenv test
   ```

3. **Run the hello world example**:
   ```bash
   devenv shell run
   ```

## Development Lifecycle

### Core Commands

- **`devenv test`** - Run the full test suite with SRFI-64
- **`devenv shell dist`** - Compile to Guile bytecode
- **`devenv shell run`** - Execute the main application
- **`devenv shell compile`** - Compile project with Guild
- **`devenv shell repl`** - Start Guile REPL with project modules
- **`guile -L . -s <file>`** - Execute Scheme files with project modules
- **`devenv update`** - Update devenv configuration
- **`nix flake update`** - Update Nix flake inputs

### Example Workflows

```bash
# Run tests
devenv test

# Run specific test file
guile -L . -s tests/test-runner.scm

# Run the main application
devenv shell run

# Start REPL with project modules loaded
devenv shell repl

# Compile to bytecode
devenv shell compile

# Check compilation warnings and errors
guild compile -Warity-mismatch -Wformat -Wunbound-variable main.scm

# Interactive development in REPL
guile -L .
scheme@(guile-user)> ,use (guile-basic hello)
scheme@(guile-user)> (greet "Developer")
```

## Project Structure

```
.
├── guile-basic/              # Project modules
│   └── hello.scm            # Hello world module
├── tests/                   # Test files
│   └── test-runner.scm      # Test suite with SRFI-64
├── main.scm                 # Main application entry point
├── devenv.nix               # devenv development environment
├── .envrc                   # Direnv configuration
├── .editorconfig           # Editor configuration
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## Code Quality Tools

### Compilation
- **Guild** - Official Guile compiler for bytecode generation
- **Guild lint** - Static analysis and linting

### Testing
- **SRFI-64** - Comprehensive testing framework with assertions

### REPL Support
- **Guile REPL** - Interactive development with module loading

## Environment Management

This template uses devenv for reproducible development environments:

- **devenv** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **GUILE_LOAD_PATH** configured to include project modules

## Configuration Files

- **`main.scm`** - Application entry point and command-line handling
- **`.editorconfig`** - Editor settings for consistent formatting
- **`devenv.nix`** - devenv development environment specification

## Module System

This template uses Guile's module system for organization:

```scheme
;; Define a module
(define-module (guile-basic hello)
  #:export (greet))

;; Use a module
(use-modules (guile-basic hello))

;; Import specific bindings
(use-modules ((guile-basic hello) #:select (greet)))
```

## Testing

Tests use SRFI-64 testing framework:

```scheme
(use-modules (srfi srfi-64))

(test-begin "my-tests")
(test-equal "expected" "actual" (my-function))
(test-end "my-tests")
```

## Getting Help

- Enter `devenv shell` to see available lifecycle commands in the shell prompt
- Use `devenv test` and `devenv shell <command>` for standard operations
- Start `guile -L .` for interactive development
- Check the [Guile manual](https://www.gnu.org/software/guile/manual/) for language reference
- Review `devenv.nix` for development environment setup

## Customization

1. Update module names in `guile-basic/` directory
2. Modify the main application in `main.scm`
3. Add new modules following the `(project-name module-name)` pattern
4. Write tests in `tests/` using SRFI-64
5. Update `devenv.nix` for additional development tools

## Emacs Configuration

For consistent Guile development using core Emacs functionality with Geiser:

### Geiser Integration
```elisp
;; Geiser for interactive Guile development
(use-package geiser
  :hook (scheme-mode . geiser-mode))

(use-package geiser-guile
  :config
  (setq geiser-guile-load-path '(".")
        geiser-guile-init-file nil))

;; Key bindings for Geiser
(with-eval-after-load 'geiser-mode
  (define-key geiser-mode-map (kbd "C-c C-z") #'geiser)
  (define-key geiser-mode-map (kbd "C-c C-k") #'geiser-eval-buffer)
  (define-key geiser-mode-map (kbd "C-c C-e") #'geiser-eval-last-sexp))
```

### Built-in Compilation for Linting
```elisp
;; Guild compilation for linting
(defun guile-compile-file ()
  "Compile current Guile file with Guild."
  (interactive)
  (when (eq major-mode 'scheme-mode)
    (let ((default-directory (project-root (project-current))))
      (compile (format "guild compile -Warity-mismatch -Wformat -Wunbound-variable %s"
                       (file-name-nondirectory buffer-file-name))))))

(define-key scheme-mode-map (kbd "C-c c") #'guile-compile-file)
```

### Formatting and Indentation
```elisp
;; Scheme formatting conventions
(add-hook 'scheme-mode-hook
          (lambda ()
            (setq-local indent-tabs-mode nil)
            (setq-local tab-width 2)
            (setq-local lisp-indent-offset 2)))

;; Format buffer using built-in indentation
(defun scheme-format-buffer ()
  "Format current Scheme buffer."
  (interactive)
  (when (eq major-mode 'scheme-mode)
    (indent-region (point-min) (point-max))))

(define-key scheme-mode-map (kbd "C-c f") #'scheme-format-buffer)