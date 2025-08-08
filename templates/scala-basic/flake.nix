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
        utils = import ../shared/template-utils.nix { inherit pkgs; lib = nixpkgs.lib; };
        javaVersion = pkgs.jdk17;
      in
      {
        apps = {
          run = utils.mkApp "${pkgs.sbt}/bin/sbt run \"$@\"";
          test = utils.mkApp "${pkgs.sbt}/bin/sbt test \"$@\"";
          build = utils.mkApp "${pkgs.sbt}/bin/sbt compile \"$@\"";
          package = utils.mkApp "${pkgs.sbt}/bin/sbt assembly \"$@\"";
          console = utils.mkApp "${pkgs.sbt}/bin/sbt console \"$@\"";
        };

        devShells.default = utils.mkDevShell {
          language = "Scala";

          buildTools = with pkgs; [
            javaVersion
            sbt
            scala_3
          ];

          devTools = with pkgs; [
            scalafmt
            metals
            coursier
          ];

          phases = {
            build = ''
              echo "🔧 Installing dependencies and setting up project..."
              sbt update
              echo "✅ Project setup complete!"
            '';
            check = ''
              echo "🧪 Running test suite..."
              sbt test
              echo "✅ Tests completed!"
            '';
            install = ''
              echo "📦 Building distribution packages..."
              sbt assembly
              echo "✅ Packages built successfully!"
            '';
          };

          shellHookCommands = [
            "sbt run                - Execute the main application"
            "sbt console            - Start Scala REPL with project classpath"
            "sbt compile            - Compile the project"
            "sbt test               - Run tests"
            "sbt assembly           - Create fat JAR"
            "scalafmt               - Format code"
          ];

          extraShellHook = ''
            # Set JAVA_HOME for tools that need it
            export JAVA_HOME="${javaVersion}"
            export PATH="$JAVA_HOME/bin:$PATH"
          '';
        };
      });
}