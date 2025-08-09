
# Guile Hall Template

A modern Guile (GNU Scheme) project template using guile-hall for project management and best practices.

## Features

This template provides a complete development environment with:

- **🏛️ Guile Hall** - Professional project management for Guile projects
- **🐧 Modern Guile tooling** - Guile 3.0 with module system support
- **🔧 Development tools** - Autotools integration, testing framework
- **🧪 Testing framework** - Integrated testing with Hall
- **🏗️ Build system** - Autotools-based build system via Hall
- **📦 Distribution** - Tarball creation for package distribution
- **📝 Configuration** - EditorConfig for consistent coding style
- **🔄 Nix environment** - Reproducible development setup with direnv

## Quick Start

1. **Enter the development environment** (happens automatically with direnv):
   ```bash
   nix develop
   ```

2. **Build the project** (initialize and build with Hall):
   ```bash
   nix develop --build
   ```

3. **Run tests**:
   ```bash
   nix develop --check
   ```

4. **Run the application**:
   ```bash
   guile -L . -s main.scm
   ```

## Development Lifecycle

### Core Commands

- **`nix develop --build`** - Initialize and build the project with Hall
- **`nix develop --check`** - Run the full test suite
- **`nix develop --install`** - Create distribution tarball
- **`hall <command>`** - Execute Hall project management commands
- **`nix flake update`** - Update Nix flake inputs (development tools)

### Hall Commands

```bash
# Project management
hall build              # Build the project
hall test               # Run test suite
hall clean              # Clean build artifacts
hall dist               # Create distribution tarball
hall compile            # Compile to bytecode

# Development workflows
guile -L . -s main.scm  # Run the main application
guile -L .              # Start REPL with project modules
```

### Example Workflows

```bash
# Start development
nix develop --build

# Continuous development cycle
hall build
hall test

# Add new modules
# Edit hall.scm to add new files/modules
hall build

# Create distribution
nix develop --install
```

## Project Structure

After initialization, Hall creates this structure:

```
.
├── hall.scm                 # Hall project configuration
├── main.scm                # Main application entry point
├── guile-hall-project/      # Project modules (auto-generated)
├── tests/                   # Test files (auto-generated)
├── configure.ac            # Autotools configuration (auto-generated)
├── Makefile.am             # Makefile template (auto-generated)
├── flake.nix              # Nix development environment
├── .envrc                 # Direnv configuration
├── .editorconfig         # Editor configuration
└── README.md             # This file
```

## Hall Project Management

### Project Configuration

Hall uses `hall.scm` for project configuration:

```scheme
;; Example hall.scm
(hall-description
  (name "guile-hall-project")
  (prefix "guile")
  (version "0.1.0")
  (author "Your Name")
  (copyright (2024))
  (synopsis "A Guile project managed by Hall")
  (description "Longer description of your project")
  (home-page "https://example.com")
  (license gpl3+)
  (dependencies `(("guile" (>= "3.0"))))
  (files (libraries ((scheme-file "guile-hall-project")))))
```

### Adding Modules

1. Edit `hall.scm` to declare new files
2. Run `hall build` to regenerate autotools files
3. Implement your modules

### Testing

Hall integrates with standard Guile testing:

```scheme
;; In tests/
(use-modules (srfi srfi-64)
             (guile-hall-project))

(test-begin "my-project-tests")
(test-equal "expected" "actual" (my-function))
(test-end)
```

## Code Quality Tools

### Build System
- **Autotools** - Professional build system integration via Hall
- **Hall** - Project structure management and scaffolding

### Testing
- **SRFI-64** - Comprehensive testing framework
- **Hall test** - Integrated test runner

### Development
- **Guile REPL** - Interactive development with module loading
- **Guild compiler** - Bytecode compilation

## Environment Management

This template uses Nix for reproducible development environments:

- **Nix flake** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **GUILE_LOAD_PATH** configured to include project modules
- **guile-hall** for professional project management

## Configuration Files

- **`hall.scm`** - Hall project configuration and metadata
- **`main.scm`** - Application entry point
- **`.editorconfig`** - Editor settings for consistent formatting
- **`flake.nix`** - Nix development environment specification

## Getting Help

- Enter `nix develop` to see available lifecycle commands in the shell prompt
- Use `nix develop --build`, `--check`, and `--install` for standard operations
- Check [Hall documentation](https://gitlab.com/a-sassmannshausen/guile-hall) for project management
- Review the [Guile manual](https://www.gnu.org/software/guile/manual/) for language reference
- Start `guile -L .` for interactive development

## Customization

1. Run `nix develop --build` to initialize the Hall project
2. Edit `hall.scm` to configure your project metadata
3. Add modules and files as declared in `hall.scm`
4. Run `hall build` after configuration changes
5. Write tests in the `tests/` directory
6. Extend the development environment in `flake.nix` if needed

## Advantages of Hall

- **Professional structure** - Follows GNU/Guile conventions
- **Autotools integration** - Standard build system for distribution
- **Metadata management** - Centralized project configuration
- **Scaffolding** - Automatic file generation and organization
- **Testing integration** - Built-in test runner and structure

Happy hacking with Hall! 🏛️
