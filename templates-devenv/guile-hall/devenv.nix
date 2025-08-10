
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
    build.exec = ''
      if [ ! -f "hall.scm" ]; then
        echo "🚀 Initializing new Hall project..."
        hall init guile-hall-project --author="Your Name" --email="your.email@example.com"
        echo "✅ Hall project initialized!"
      else
        echo "Hall project already initialized."
      fi
      if [ -f "hall.scm" ]; then
        hall build
        echo "✅ Project built successfully!"
      fi
    '';

    check.exec = ''
      echo "🧪 Running test suite..."
      hall test "$@"
      echo "✅ Tests completed!"
    '';

    install.exec = ''
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
    echo "🏛️ Guile Hall Development Environment"
    echo "====================================="
    echo ""
    
    # Auto-initialize Hall project if not already done
    if [ ! -f "hall.scm" ]; then
      echo "🚀 Initializing new Hall project..."
      hall init guile-hall-project --author="Your Name" --email="your.email@example.com"
      echo "✅ Hall project initialized!"
      echo ""
    fi
    
    echo "Standard devenv commands:"
    echo "  devenv shell build    - Initialize/build Hall project"
    echo "  devenv shell check    - Run test suite"
    echo "  devenv shell install  - Create distribution"
    echo ""
    echo "Development commands:"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell repl     - Start Guile REPL"
    echo "  devenv shell compile  - Compile with Hall"
    echo ""
    echo "Hall commands:"
    echo "  hall build            - Build project with autotools"
    echo "  hall test             - Run test suite"
    echo "  hall dist             - Create distribution tarball"
    echo "  hall compile          - Compile to bytecode"
    echo ""
    echo "Environment ready! Run 'devenv shell build' to get started."
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };
}
