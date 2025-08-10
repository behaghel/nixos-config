
{ pkgs, lib, config, inputs, ... }:

{
  packages = with pkgs; [
    guile_3_0
    pkg-config
    texinfo
    automake
    autoconf
    libtool
    git
  ];

  scripts = {
    build.exec = ''
      echo "🔧 Compiling Guile project..."
      guild compile -L . main.scm
      echo "✅ Project setup complete!"
    '';

    check.exec = ''
      echo "🧪 Running test suite..."
      guile -L . -s tests/test-runner.scm
      echo "✅ Tests completed!"
    '';

    install.exec = ''
      echo "📦 Compiling to Guile bytecode..."
      guild compile -L . main.scm
      guild compile -L . guile-basic/hello.scm
      echo "✅ Bytecode compilation completed!"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      guile -L . -s main.scm "$@"
    '';

    repl.exec = ''
      echo "🔍 Starting Guile REPL..."
      guile -L . "$@"
    '';

    compile.exec = ''
      echo "🔨 Compiling with Guild..."
      guild compile -L . "$@"
    '';
  };

  enterShell = ''
    echo "🐧 Guile Development Environment"
    echo "=================================="
    echo ""
    echo "Standard devenv commands:"
    echo "  devenv shell build    - Compile the project"
    echo "  devenv shell check    - Run test suite"
    echo "  devenv shell install  - Compile to bytecode"
    echo ""
    echo "Development commands:"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell repl     - Start Guile REPL"
    echo "  devenv shell compile  - Compile with Guild"
    echo ""
    echo "Manual commands:"
    echo "  guile -L . -s main.scm - Run main application"
    echo "  guile -L .             - Start REPL with project modules"
    echo "  guild compile -L . <file> - Compile specific file"
    echo ""
    echo "Environment ready! Run 'devenv shell build' to get started."
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };
}
