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
    dist.exec = ''
      echo "📦 Creating distribution..."
      hall dist "$@"
      echo "✅ Distribution created!"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      guile -L . -s guile-hall-project.scm "$@"
    '';

    repl.exec = ''
      echo "🔍 Starting Guile REPL..."
      guile -L . "$@"
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
      hall init guile-hall-project --author="Your Name" --email="your.email@example.com"
      echo "✅ Hall project initialized!"
      echo ""
    fi
    
    echo "🏛️ Guile Hall Development Environment"
    echo "====================================="
    echo ""
    echo "Available commands:"
    echo "  devenv test           - Run test suite"
    echo "  devenv shell dist     - Create distribution"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell repl     - Start Guile REPL"
    echo "  devenv shell compile  - Compile with Hall"
    echo ""
    echo "Environment ready!"
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };

  # Use devenv's built-in test functionality
  test = ''
    echo "🧪 Running test suite..."
    hall test "$@"
    echo "✅ Tests completed!"
  '';
}