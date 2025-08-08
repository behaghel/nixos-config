
{
  description = "Scala development environment with sbt";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs@{ self, nixpkgs }:
    let
      templateUtils = import ../../lib/template-utils.nix { inherit nixpkgs; };
      
      scalaConfig = {
        language = "Scala";
        icon = "⚡";
        
        buildTools = with nixpkgs.legacyPackages.x86_64-linux; [
          jdk17
          sbt
          scala_3
        ];
        
        devTools = with nixpkgs.legacyPackages.x86_64-linux; [
          scalafmt
          metals
          coursier
        ];
        
        apps = {
          run = "sbt run \"$@\"";
          test = "sbt test \"$@\"";
          compile = "sbt compile \"$@\"";
          package = "sbt assembly \"$@\"";
          console = "sbt console \"$@\"";
          clean = "sbt clean \"$@\"";
        };
        
        phases = {
          build = ''
            echo "🔧 Compiling Scala project..."
            sbt compile
            echo "✅ Project setup complete!"
          '';
          check = ''
            echo "🧪 Running test suite..."
            sbt test
            echo "✅ Tests completed!"
          '';
          install = ''
            echo "📦 Building fat JAR..."
            sbt assembly
            echo "✅ Packages built successfully!"
          '';
        };
        
        extraShellHook = ''
          export JAVA_HOME=${nixpkgs.legacyPackages.x86_64-linux.jdk17}
          
          echo "Commands:"
          echo "  sbt run                - Run the main application"
          echo "  sbt test               - Run test suite"
          echo "  sbt console            - Start Scala REPL"
          echo "  sbt assembly           - Create fat JAR"
        '';
      };
    in
    templateUtils.mkTemplate scalaConfig inputs;
}
