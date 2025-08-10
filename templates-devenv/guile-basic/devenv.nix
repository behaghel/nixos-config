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
    echo "Available commands:"
    echo "  devenv shell check    - Run test suite"
    echo "  devenv shell install  - Compile to bytecode"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell repl     - Start Guile REPL"
    echo "  devenv shell compile  - Compile with Guild"
    echo ""
    echo "Environment ready!"
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };
}