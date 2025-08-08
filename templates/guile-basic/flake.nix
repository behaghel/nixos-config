{
  description = "Guile development environment with scheme tools";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    template-utils.url = "github:behaghel/nixos-config";
  };

  outputs = { self, nixpkgs, template-utils }:
    {
      perSystem = { system, ... }:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          utils = template-utils.lib.templateUtils;
          guileVersion = pkgs.guile_3_0;
        in
        {
          apps = {
            run = utils.mkApp "${guileVersion}/bin/guile -L . -s main.scm \"$@\"" pkgs;
            test = utils.mkApp "${guileVersion}/bin/guile -L . -s tests/test-runner.scm \"$@\"" pkgs;
            repl = utils.mkApp "${guileVersion}/bin/guile -L . \"$@\"" pkgs;
            compile = utils.mkApp "${guileVersion}/bin/guild compile -L . main.scm \"$@\"" pkgs;
            check = utils.mkApp "${guileVersion}/bin/guild compile -Warity-mismatch -Wformat -Wmacro-use-before-definition -Wunused-variable -L . main.scm \"$@\"" pkgs;
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
          } pkgs;
        };
    };
}