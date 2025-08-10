
{
  description = "Guile development environment with guile-hall project management";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ self, nixpkgs }:
    let
      templateUtils = import ./template-utils.nix { inherit nixpkgs; };
      guileVersion = nixpkgs.legacyPackages.x86_64-linux.guile_3_0;
      
      guileConfig = {
        language = "Guile";
        icon = "🏛️";
        
        buildTools = with nixpkgs.legacyPackages.x86_64-linux; [
          guile_3_0
          guile-hall
        ];
        
        devTools = with nixpkgs.legacyPackages.x86_64-linux; [
          pkg-config
          texinfo
          automake
          autoconf
          libtool
        ];
        
        apps = {
          run = "${guileVersion}/bin/guile -L . -s guile-hall-project.scm \"$@\"";
          test = "hall test \"$@\"";
          lint = "find . -name \"*.scm\" -not -path \"./tests/*\" -exec guild compile -Warity-mismatch -Wformat -Wunbound-variable {} \\; 2>&1 | grep -E \"(warning|error)\" || echo \"✅ No linting issues found!\"";
          format = "echo \"🎨 Formatting guidelines for Guile:\"; echo \"   - Use 2 spaces for indentation\"; echo \"   - Align function arguments vertically\"; echo \"   - Keep lines under 80 characters\"";
          repl = "${guileVersion}/bin/guile -L . \"$@\"";
          compile = "hall compile \"$@\"";
          build = "hall build \"$@\"";
          clean = "hall clean \"$@\"";
          dist = "hall dist \"$@\"";
        };
        
        phases = {
          build = ''
            echo "🔧 Setting up Guile Hall project..."
            # Initialize hall project if not already done
            if [ ! -f "hall.scm" ]; then
              echo "Initializing new Hall project..."
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
          check = ''
            echo "🧪 Running test suite..."
            hall test
            echo "✅ Tests completed!"
          '';
          install = ''
            echo "📦 Building distribution package..."
            hall dist
            echo "✅ Distribution package built successfully!"
          '';
        };
        
        extraShellHook = ''
          # Set GUILE_LOAD_PATH to include current directory
          export GUILE_LOAD_PATH=".:$GUILE_LOAD_PATH"
          export GUILE_LOAD_COMPILED_PATH=".:$GUILE_LOAD_COMPILED_PATH"
          
          echo "Standard Commands:"
          echo "  nix run .#lint         - Lint source code with Guild"
          echo "  nix run .#format       - Show formatting guidelines"
          echo "  nix run .#repl         - Start REPL with project modules"
          echo ""
          echo "Hall Commands:"
          echo "  hall build             - Build the project"
          echo "  hall test              - Run test suite"
          echo "  hall clean             - Clean build artifacts"
          echo "  hall dist              - Create distribution tarball"
          echo "  hall compile           - Compile to bytecode"
        '';
      };
    in
    templateUtils.mkTemplate guileConfig inputs;
}
