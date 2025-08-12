{ pkgs, lib, config, inputs, ... }:

{
  packages = with pkgs; [
    guile_3_0
    guile_3_0.dev  # Provides guile.m4 with GUILE_PKG macro
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
      echo "🚀 Initializing new Hall project..."
      
      # Initialize Hall project without --execute flag
      hall init guile-hall-project --author="$ORGANIZATION"
      
      # Move files from subdirectory to root
      if [ -d "guile-hall-project" ]; then
        # Use cp to avoid overwrite issues, then remove source
        cp -r guile-hall-project/* . 2>/dev/null || true
        cp -r guile-hall-project/.* . 2>/dev/null || true
        rm -rf guile-hall-project
      fi
      
      # Copy template resources to appropriate locations
      if [ -d ".template-resources" ]; then
        echo "📋 Installing template example files..."
        
        # Copy math module to the main project directory
        if [ -f ".template-resources/math.scm" ]; then
          cp ".template-resources/math.scm" .
          echo "  ✓ Added math.scm module with example functions"
        fi
        
        # Copy test files to tests directory
        if [ -f ".template-resources/test-math.scm" ] && [ -d "tests" ]; then
          cp ".template-resources/test-math.scm" "tests/"
          echo "  ✓ Added test-math.scm with comprehensive unit tests"
        fi
      fi
      
      echo "✅ Hall project initialized with examples!"
      echo ""
    fi
    
    # Always scan for new files and update Hall project structure
    if [ -f "hall.scm" ]; then
      echo "🔍 Scanning for new files and updating Hall project..."
      hall scan -x
      echo "✅ Hall project updated!"
      echo ""
    fi
    
    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "$GREETING"
    fi
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
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
    
    # Ensure Hall project is up to date
    hall scan -x
    
    # Build and run tests using Hall's proper lifecycle
    if ! hall build; then
      echo "❌ Build failed"
      exit 1
    fi
    
    if ! hall test; then
      echo "❌ Tests failed"
      exit 1
    fi
    
    echo "✅ All tests passed!"
  '';
}