
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
          run = "${guileVersion}/bin/guile -L . -s main.scm \"$@\"";
          test = "hall test \"$@\"";
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
            fi
            hall build
            echo "✅ Project setup complete!"
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
          
          echo "Hall Commands:"
          echo "  hall build             - Build the project"
          echo "  hall test              - Run test suite"
          echo "  hall clean             - Clean build artifacts"
          echo "  hall dist              - Create distribution tarball"
          echo "  hall compile           - Compile to bytecode"
          echo ""
          echo "Development Commands:"
          echo "  guile -L . -s main.scm - Run the main application"
          echo "  guile -L .             - Start REPL with project modules"
        '';
      };
    in
    templateUtils.mkTemplate guileConfig inputs;
}
