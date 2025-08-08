
{
  description = "Guile development environment with scheme tools";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        guileVersion = pkgs.guile_3_0;
      in
      {
        apps = {
          # Guile project commands
          run = {
            type = "app";
            program = "${pkgs.writeShellScript "guile-run" ''
              exec ${guileVersion}/bin/guile -L . -s main.scm "$@"
            ''}";
          };
          
          test = {
            type = "app";
            program = "${pkgs.writeShellScript "guile-test" ''
              exec ${guileVersion}/bin/guile -L . -s tests/test-runner.scm "$@"
            ''}";
          };
          
          repl = {
            type = "app";
            program = "${pkgs.writeShellScript "guile-repl" ''
              exec ${guileVersion}/bin/guile -L . "$@"
            ''}";
          };
          
          compile = {
            type = "app";
            program = "${pkgs.writeShellScript "guile-compile" ''
              exec ${guileVersion}/bin/guild compile -L . main.scm "$@"
            ''}";
          };
          
          check = {
            type = "app";
            program = "${pkgs.writeShellScript "guile-check" ''
              exec ${guileVersion}/bin/guild compile -Warity-mismatch -Wformat -Wmacro-use-before-definition -Wunused-variable -L . main.scm "$@"
            ''}";
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Guile and development tools
            guileVersion
            guile-lint

            # Build and development tools
            pkg-config
            texinfo
            automake
            autoconf

            # Additional tools
            git
            just
          ];

          # Standard Nix build phases for development
          buildPhase = ''
            echo "🔧 Setting up Guile project..."
            ${guileVersion}/bin/guild compile -L . main.scm
            echo "✅ Project setup complete!"
          '';

          checkPhase = ''
            echo "🧪 Running test suite..."
            ${guileVersion}/bin/guile -L . -s tests/test-runner.scm
            echo "✅ Tests completed!"
          '';

          installPhase = ''
            echo "📦 Compiling Guile bytecode..."
            ${guileVersion}/bin/guild compile -L . main.scm
            echo "✅ Bytecode compiled successfully!"
          '';

          shellHook = ''
            echo "🐧 Guile Development Environment"
            echo "=================================="
            echo ""
            echo "Standard Nix commands:"
            echo "  nix develop --build    - Compile the project"
            echo "  nix develop --check    - Run test suite"
            echo "  nix develop --install  - Compile to bytecode"
            echo ""
            echo "Additional commands:"
            echo "  guile -L . -s main.scm - Run the main application"
            echo "  guile -L .             - Start REPL with project modules"
            echo "  guild compile main.scm - Compile to bytecode"
            echo "  guild lint main.scm    - Lint source code"
            echo ""
            echo "Environment ready! Run 'nix develop --build' to get started."

            # Set GUILE_LOAD_PATH to include current directory
            export GUILE_LOAD_PATH=".:$GUILE_LOAD_PATH"
            export GUILE_LOAD_COMPILED_PATH=".:$GUILE_LOAD_COMPILED_PATH"
          '';
        };
      });
}
