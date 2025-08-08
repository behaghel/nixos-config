
{
  description = "Guile development environment with scheme tools";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ self, nixpkgs }:
    let
      templateUtils = import ./template-utils.nix { inherit nixpkgs; };
      guileVersion = nixpkgs.legacyPackages.x86_64-linux.guile_3_0;
      
      guileConfig = {
        language = "Guile";
        icon = "🐧";
        
        buildTools = with nixpkgs.legacyPackages.x86_64-linux; [
          guile_3_0
        ];
        
        devTools = with nixpkgs.legacyPackages.x86_64-linux; [
          pkg-config
          texinfo
          automake
          autoconf
        ];
        
        apps = {
          run = "${guileVersion}/bin/guile -L . -s main.scm \"$@\"";
          test = "${guileVersion}/bin/guile -L . -s tests/test-runner.scm \"$@\"";
          repl = "${guileVersion}/bin/guile -L . \"$@\"";
          compile = "${guileVersion}/bin/guild compile -L . main.scm \"$@\"";
          check = "${guileVersion}/bin/guild compile -Warity-mismatch -Wformat -Wmacro-use-before-definition -Wunused-variable -L . main.scm \"$@\"";
        };
        
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
        
        extraShellHook = ''
          # Set GUILE_LOAD_PATH to include current directory
          export GUILE_LOAD_PATH=".:$GUILE_LOAD_PATH"
          export GUILE_LOAD_COMPILED_PATH=".:$GUILE_LOAD_COMPILED_PATH"
          
          echo "Commands:"
          echo "  guile -L . -s main.scm - Run the main application"
          echo "  guile -L .             - Start REPL with project modules"
          echo "  guild compile main.scm - Compile to bytecode"
          echo "  guild lint main.scm    - Lint source code"
        '';
      };
    in
    templateUtils.mkTemplate guileConfig inputs;
}
