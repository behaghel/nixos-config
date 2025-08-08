
{
  description = "Scala development environment with sbt";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        javaVersion = pkgs.jdk17;
      in
      {
        apps = {
          # Scala project commands via sbt
          run = {
            type = "app";
            program = "${pkgs.writeShellScript "sbt-run" ''
              exec ${pkgs.sbt}/bin/sbt run "$@"
            ''}";
          };
          
          test = {
            type = "app";
            program = "${pkgs.writeShellScript "sbt-test" ''
              exec ${pkgs.sbt}/bin/sbt test "$@"
            ''}";
          };
          
          build = {
            type = "app";
            program = "${pkgs.writeShellScript "sbt-build" ''
              exec ${pkgs.sbt}/bin/sbt compile "$@"
            ''}";
          };
          
          package = {
            type = "app";
            program = "${pkgs.writeShellScript "sbt-package" ''
              exec ${pkgs.sbt}/bin/sbt assembly "$@"
            ''}";
          };
          
          console = {
            type = "app";
            program = "${pkgs.writeShellScript "sbt-console" ''
              exec ${pkgs.sbt}/bin/sbt console "$@"
            ''}";
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Java and Scala tooling
            javaVersion
            sbt
            scala_3
            scalafmt

            # Development tools
            metals
            coursier

            # Build tools
            git
            just
          ];

          # Standard Nix build phases for development
          buildPhase = ''
            echo "🔧 Installing dependencies and setting up project..."
            sbt update
            echo "✅ Project setup complete!"
          '';

          checkPhase = ''
            echo "🧪 Running test suite..."
            sbt test
            echo "✅ Tests completed!"
          '';

          installPhase = ''
            echo "📦 Building distribution packages..."
            sbt assembly
            echo "✅ Packages built successfully!"
          '';

          # Enable phases for nix develop --check, --build, --install
          enablePhases = [ "check" "build" "install" ];

          shellHook = ''
            echo "⚡ Scala Development Environment"
            echo "=================================="
            echo ""
            echo "Standard Nix commands:"
            echo "  nix develop --build    - Install dependencies and setup project"
            echo "  nix develop --check    - Run test suite with ScalaTest"
            echo "  nix develop --install  - Build distribution JAR"
            echo ""
            echo "Additional commands:"
            echo "  sbt run                - Execute the main application"
            echo "  sbt console            - Start Scala REPL with project classpath"
            echo "  sbt compile            - Compile the project"
            echo "  sbt test               - Run tests"
            echo "  sbt assembly           - Create fat JAR"
            echo "  scalafmt               - Format code"
            echo ""
            echo "Environment ready! Run 'nix develop --build' to get started."

            # Set JAVA_HOME for tools that need it
            export JAVA_HOME="${javaVersion}"
            export PATH="$JAVA_HOME/bin:$PATH"
          '';
        };
      });
}
