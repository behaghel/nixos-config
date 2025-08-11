{ pkgs, lib, config, inputs, ... }:

{
  packages = with pkgs; [
    guile_3_0
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
  };

  enterShell = ''
    # Initialize project if not already initialized
    if [ ! -f "hall.scm" ]; then
      echo "🚀 Initializing new Hall project..."
      hall init guile-hall-project --author="$ORGANIZATION" --execute
      # Move files from subdirectory to root
      if [ -d "guile-hall-project" ]; then
        mv guile-hall-project/* .
        mv guile-hall-project/.* . 2>/dev/null || true
        rmdir guile-hall-project
      fi
      echo "✅ Hall project initialized!"
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
    echo "🧪 Running test suite..."
    hall build check --execute
    echo "✅ Tests completed!"
  '';
}