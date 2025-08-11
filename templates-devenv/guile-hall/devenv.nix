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
    # Auto-initialize Hall project if needed
    if [ ! -f "hall.scm" ]; then
      echo "🚀 Initializing new Hall project..."
      hall init guile-hall-project --author="$ORGANIZATION" --execute
      echo "✅ Hall project initialized!"
      echo ""
    fi
    
    # Only show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "🏛️ Guile Hall Development Environment"
      echo "====================================="
      echo ""
      echo "Available commands:"
      echo "  devenv test           - Run test suite"
      echo "  devenv shell lint     - Lint source code"
      echo "  devenv shell format   - Format source code (guidelines)"
      echo "  devenv shell repl     - Start Guile REPL with project loaded"
      echo "  devenv shell dist     - Create distribution"
      echo "  devenv shell run      - Run the main application"
      echo "  devenv shell compile  - Compile with Hall"
      echo ""
      echo "Environment ready!"
    fi
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    hall test "$@"
    echo "✅ Tests completed!"
  '';
}