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
    dist.exec = ''
      echo "📦 Compiling to Guile bytecode..."
      guild compile -L . main.scm
      guild compile -L . guile-basic/hello.scm
      echo "✅ Bytecode compilation completed!"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      guile -L . -s main.scm "$@"
    '';

    format.exec = ''
      echo "📝 No standard Guile formatter available"
      echo "💡 Consider using Emacs with geiser for consistent formatting"
    '';

    lint.exec = ''
      echo "🔍 Linting with Guild compiler warnings..."
      guild compile -Warity-mismatch -Wformat -L . guile-basic/hello.scm
      echo "✅ Linting completed!"
    '';

    repl.exec = ''
      echo "🐧 Starting Guile REPL..."
      guile -L . "$@"
    '';

    compile.exec = ''
      echo "🔨 Compiling with Guild..."
      guild compile -L . "$@"
    '';
  };

  enterShell = ''
    # Auto-create basic Guile project structure if needed
    if [ ! -f "main.scm" ]; then
      echo "🚀 Creating basic Guile project structure..."
      mkdir -p guile-basic tests

      cat > main.scm << 'EOF'
#!/usr/bin/env guile
!#

(add-to-load-path ".")
(use-modules (guile-basic hello))

(display (hello-world))
(newline)
EOF

      cat > guile-basic/hello.scm << 'EOF'
(define-module (guile-basic hello)
  #:export (hello-world))

(define (hello-world)
  "Hello, World from Guile!")
EOF

      cat > tests/test-runner.scm << 'EOF'
(use-modules (srfi srfi-64)
             (guile-basic hello))

(test-begin "guile-basic-tests")

(test-equal "hello-world returns greeting"
  "Hello, World from Guile!"
  (hello-world))

(test-end "guile-basic-tests")
EOF

      chmod +x main.scm
      echo "✅ Guile project structure created!"
      echo ""
    fi

    echo "🐧 Guile Development Environment"
    echo "=================================="
    echo ""
    echo "Available commands:"
    echo "  devenv test           - Run test suite"
    echo "  devenv shell dist     - Create distribution"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell format   - Format code (manual for Guile)"
    echo "  devenv shell lint     - Lint code with Guild warnings"
    echo "  devenv shell repl     - Start Guile REPL"
    echo "  devenv shell compile  - Compile Guile modules"
    echo ""
    echo "Environment ready!"
  '';

  env = {
    GUILE_LOAD_PATH = "./";
    GUILE_LOAD_COMPILED_PATH = "./";
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    guile -L . -s tests/test-runner.scm
    echo "✅ Tests completed!"
  '';
}