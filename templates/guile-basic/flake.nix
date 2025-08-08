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
        utils = import ../shared/template-utils.nix { inherit pkgs; lib = nixpkgs.lib; };
        guileVersion = pkgs.guile_3_0;
      in
      {
        apps = {
          run = utils.mkApp "${guileVersion}/bin/guile -L . -s main.scm \"$@\"";
          test = utils.mkApp "${guileVersion}/bin/guile -L . -s tests/test-runner.scm \"$@\"";
          repl = utils.mkApp "${guileVersion}/bin/guile -L . \"$@\"";
          compile = utils.mkApp "${guileVersion}/bin/guild compile -L . main.scm \"$@\"";
          check = utils.mkApp "${guileVersion}/bin/guild compile -Warity-mismatch -Wformat -Wmacro-use-before-definition -Wunused-variable -L . main.scm \"$@\"";
        };

        devShells.default = utils.mkDevShell {
          language = "Guile";

          buildTools = with pkgs; [
            guileVersion
          ];

          devTools = with pkgs; [
            guile-lint
            pkg-config
            texinfo
            automake
            autoconf
          ];

          phases = {
            build = ''
              echo "🔧 Setting up Guile project..."
              ${guileVersion}/bin/guild compile -L . main.scm
              echo "✅ Project setup complete!"
            '';
            check = ''
              echo "🧪 Running test suite..."
              ${guileVersion}/bin/guile -L . -s tests/test-runner.scm
              echo "✅ Tests completed!"
            '';
            install = ''
              echo "📦 Compiling Guile bytecode..."
              ${guileVersion}/bin/guild compile -L . main.scm
              echo "✅ Bytecode compiled successfully!"
            '';
          };

          shellHookCommands = [
            "guile -L . -s main.scm - Run the main application"
            "guile -L .             - Start REPL with project modules"
            "guild compile main.scm - Compile to bytecode"
            "guild lint main.scm    - Lint source code"
          ];

          extraShellHook = ''
            # Set GUILE_LOAD_PATH to include current directory
            export GUILE_LOAD_PATH=".:$GUILE_LOAD_PATH"
            export GUILE_LOAD_COMPILED_PATH=".:$GUILE_LOAD_COMPILED_PATH"
          '';
        };
      });
}