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
    init.exec = ''
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
    '';

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
    # Initialize project if in interactive mode and not already initialized
    if [[ $- == *i* ]] && [ ! -f "main.scm" ]; then
      devenv shell init
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
🐧 Guile Basic Development Environment
======================================

Available commands:
  devenv test           - Run test suite
  devenv shell run      - Run the main application
  devenv shell repl     - Start Guile REPL with project loaded
  devenv shell compile  - Compile to bytecode
  devenv shell lint     - Lint source code
  devenv shell format   - Format source code (guidelines)

Environment ready!'';
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    guile -L . -s tests/test-runner.scm
    echo "✅ Tests completed!"
  '';
}