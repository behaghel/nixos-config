
# Pharo Basic Template (devenv)

A modern Pharo Smalltalk project template with best practices and tooling for rapid development using [devenv](https://github.com/cachix/devenv).

## Features

This template provides a complete development environment with:

- **🐹 Modern Pharo tooling** - Pharo Smalltalk with automatic image management
- **🔧 Development tools** - Pharo Launcher, headless testing, code critics
- **🧪 Testing framework** - SUnit for comprehensive testing
- **🏗️ Build system** - Tonel format for git-friendly source code
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 devenv environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   devenv shell
   ```

2. **The project will auto-bootstrap** on first visit, downloading Pharo image and loading code

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

- **`devenv test`** - Run the full test suite headlessly with SUnit
- **`devenv shell run`** - Execute the main application
- **`devenv shell setup`** - Download/setup Pharo image manually
- **`devenv shell repl`** - Start Pharo IDE for interactive development
- **`devenv shell lint`** - Run code critics and quality checks
- **`devenv shell dist`** - Create distribution package
- **`devenv update`** - Update devenv configuration
- **`nix flake update`** - Update Nix development tools

### Example Workflows

```bash
# Run tests headlessly (CI/CD friendly)
devenv test

# Start interactive development
devenv shell repl

# Check code quality
devenv shell lint

# Create a distribution
devenv shell dist
```

## Project Structure

```
src/                         # Source code in Tonel format
├── BaselineOfPharoBasic/    # Metacello baseline (bill of materials)
│   ├── BaselineOfPharoBasic.class.st  # Project dependencies and structure
│   └── package.st           # Baseline package definition
├── PharoBasic/              # Main package source code
│   ├── PharoBasicExample.class.st     # Example class with business logic
│   └── package.st           # Package definition
└── PharoBasic-Tests/        # Test package source code
    ├── PharoBasicExampleTest.class.st # Test cases for example class
    └── package.st           # Test package definition

pharo-local/                 # Local Pharo image and VM (auto-created)
├── Pharo.image              # Pharo image file
├── Pharo.changes            # Changes file
└── pharo-vm/               # Pharo virtual machine

startup.st                   # Bootstrap script for loading packages
```

## Metacello Integration

This template uses [Metacello](https://github.com/Metacello/metacello) as the project management and dependency resolution system:

### Baseline Definition
The `BaselineOfPharoBasic` class defines the project's "bill of materials":
- **Package dependencies** - Defines which packages depend on others
- **Load groups** - Organizes packages into logical groups (Core, Tests, etc.)
- **External dependencies** - Can specify external libraries and their versions

### Loading the Project
The project is loaded using Metacello:
```smalltalk
Metacello new
  baseline: 'PharoBasic';
  repository: 'tonel://src';
  load.
```

### Package Groups
- **Core** - Main application packages (`PharoBasic`)
- **Tests** - Test packages (`PharoBasic-Tests`)
- **default** - Loads both Core and Tests

### Adding Dependencies
To add external dependencies, modify the baseline:
```smalltalk
spec
  baseline: 'SomeLibrary' 
  with: [ spec repository: 'github://user/repo:main/src' ];
  package: 'PharoBasic' with: [ spec requires: #('SomeLibrary') ].
```

## Development Tools

### Source Code Management
- **Tonel format** - Git-friendly Smalltalk source code format
- **Metacello** - Project management and dependency resolution
- **Automatic loading** - Code automatically loaded into Pharo image via baseline

### Testing
- **SUnit** - Comprehensive testing framework with assertions
- **Headless testing** - CI/CD friendly test execution with `xvfb-run`
- **JUnit XML output** - Compatible test result format

### Code Quality
- **Code Critics** - Built-in Pharo linting and quality analysis
- **Refactoring Browser** - Advanced code refactoring tools

### Interactive Development
- **Pharo IDE** - Full-featured Smalltalk development environment
- **System Browser** - Navigate and edit classes and methods
- **Playground** - Interactive code evaluation workspace
- **Debugger** - Step-through debugging with live object inspection

## Environment Management

This template uses devenv for reproducible development environments:

- **devenv** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **Pharo Launcher** handles Pharo image downloads and management
- **Auto-bootstrapping** creates project structure using community best practices

## Configuration Files

- **`devenv.nix`** - devenv development environment specification
- **`.editorconfig`** - Editor settings for consistent formatting
- **`src/*/package.st`** - Package definitions for Tonel format
- **`.gitignore`** - Excludes image files and build artifacts

## Testing

Tests use SUnit, Pharo's built-in testing framework:

```smalltalk
testGreet
    "Test the greet method"
    | result |
    result := example greet: 'Alice'.
    self assert: result equals: 'Hello, Alice!'
```

Run tests headlessly for CI/CD:
```bash
devenv test
```

## Getting Help

- Enter `devenv shell` to see available lifecycle commands in the shell prompt
- Use `devenv shell repl` to start the Pharo IDE for interactive development
- Check the [Pharo documentation](https://pharo.org/documentation) for language reference
- Review `devenv.nix` for development environment setup
- Examine `src/` and `tests/` for code examples

## Customization

1. Update the baseline in `src/BaselineOfPharoBasic/` to define dependencies
2. Update package names in `src/` and `tests/` directories
3. Modify the main application in `PharoBasicExample`
4. Add new classes following Smalltalk naming conventions
5. Write tests using SUnit assertions
6. Add external dependencies via Metacello in the baseline
7. Update `devenv.nix` for additional development tools

## Emacs Configuration

For consistent Pharo development using core Emacs functionality:

### Smalltalk Mode
```elisp
;; Smalltalk mode for .st files
(use-package smalltalk-mode
  :mode "\\.st\\'")

;; Set proper indentation
(add-hook 'smalltalk-mode-hook
          (lambda ()
            (setq tab-width 4)
            (setq indent-tabs-mode t)))
```

### Project Integration
```elisp
;; Use project.el for navigation
(use-package project
  :bind (("C-x p f" . project-find-file)
         ("C-x p s" . project-shell)
         ("C-x p d" . project-dired)))

;; Compilation mode for testing
(setq compilation-scroll-output t)
```

## Git-Friendly Development

This template uses Tonel format for git-friendly Smalltalk development:

- **File-per-class** - Each class is stored in a separate `.st` file
- **Readable diffs** - Changes are visible in standard git diff tools
- **Merge-friendly** - Conflicts can be resolved using standard git tools
- **Standard structure** - Follows community conventions for Pharo projects

The Pharo image files (`*.image`, `*.changes`) are excluded from git as they are binary and regenerated from source code.
