{ pkgs, lib, config, inputs, ... }:
{
  packages = with pkgs; [
    guile_3_0
    guile_3_0.dev  # Provides guile.m4 with GUILE_PKG macro and guild
    guile-hall
    pkg-config
    texinfo
    automake
    autoconf
    libtool
    git
  ];

  scripts = {
    lint.exec = ''
      echo "🔍 Linting Guile code..."
      # Use guild compile for linting with warnings
      find . -name "*.scm" -not -path "./tests/*" -exec guild compile -Warity-mismatch -Wformat -Wunbound-variable {} \; 2>&1 | grep -E "(warning|error)" || echo "✅ No linting issues found!"
    '';

    format.exec = ''
      echo "🎨 Formatting Guile code..."
      echo "ℹ️  Manual formatting required for Guile. Use consistent indentation:"
      echo "   - 2 spaces for indentation"
      echo "   - Align function arguments vertically"
      echo "   - Keep line length under 80 characters"
      echo "✅ Formatting guidelines displayed!"
    '';

    repl.exec = ''
      echo "🔍 Starting Guile REPL with project modules..."
      guile -L . "$@"
    '';

    dist.exec = ''
      echo "📦 Creating distribution..."
      hall dist "$@"
      echo "✅ Distribution created!"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      guile -L . -s guile-hall-project.scm "$@"
    '';

    compile.exec = ''
      echo "🔨 Compiling with Hall..."
      hall compile "$@"
    '';

    build.exec = ''
      echo "🏗️ Building project with autotools..."
      if [ ! -f "configure" ] || [ "configure.ac" -nt "configure" ]; then
        echo "🔧 Regenerating configure script..."
        autoreconf -vif
      fi
      if [ ! -f "Makefile" ]; then
        echo "🔧 Running configure..."
        ./configure
      fi
      echo "🔨 Running make..."
      make
      echo "✅ Build completed!"
    '';
  };

  enterShell = ''
    # Initialize project if not already initialized
    if [ ! -f "hall.scm" ]; then
      echo "🏛️ Bootstrapping new Guile Hall project..."
      
      # Copy template resources to project root
      if [ -d "template-resources" ]; then
        echo "📁 Copying template files..."
        cp -r template-resources/* .
        rm -rf template-resources
        echo "  ✓ Template files copied and template-resources cleaned up"
      fi
      
      # Initialize Hall project with --execute flag
      hall init guile-hall-project --author="Your Name" --execute
      
      # Move files from subdirectory to root
      if [ -d "guile-hall-project" ]; then
        # Use cp to avoid overwrite issues, then remove source
        cp -r guile-hall-project/* . 2>/dev/null || true
        cp -r guile-hall-project/.* . 2>/dev/null || true
        rm -rf guile-hall-project
        echo "  ✓ Moved files from guile-hall-project/ to root directory"
      fi

      # finishing initialisation of the build infra
      hall scan -x # register new files in hall.scm
      hall build -x # generate configure.ac
      autoreconf -vif && ./configure && make
      
      echo "✅ Project bootstrapped successfully!"
      echo ""
    fi

    # Always scan for new files and update Hall project structure
    if [ -f "hall.scm" ]; then
      hall scan -x # register new files in hall.scm
    fi

    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "${config.env.GREETING}"
    fi
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
    GUILE_AUTO_COMPILE = "0";  # Suppress auto-compilation warnings
    GUILD = "${pkgs.guile_3_0}/bin/guild";
    GREETING = ''
🏛️ Guile Hall Development Environment
=====================================

Available commands:
  devenv test           - Run test suite
  devenv shell build    - Build project with autotools
  devenv shell lint     - Lint source code
  devenv shell format   - Format source code (guidelines)
  devenv shell repl     - Start Guile REPL with project loaded
  devenv shell dist     - Create distribution
  devenv shell run      - Run the main application
  devenv shell compile  - Compile with Hall

Environment ready!'';
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite with Hall..."
    
    # Run tests using Hall's check command
    echo "🧪 Running tests..."
    if ! make check; then
      echo "❌ Tests failed"
      exit 1
    fi
    
    echo "✅ All tests passed!"
  '';

  # Agent configuration (Claude Code + OpenCode)
  # Skills and hooks sourced from the agent marketplace.
  claude.code = {
    enable = true;
    hooks = import (inputs.agent-marketplace + "/marketplace/hooks/notification.nix");
    mcpServers.devenv = import (inputs.agent-marketplace + "/marketplace/mcp/devenv.nix");
  };

  opencode = {
    enable = true;
    skills = inputs.agent-marketplace + "/marketplace/skills";
  };
}
