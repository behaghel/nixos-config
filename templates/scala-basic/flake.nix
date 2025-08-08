{
  description = "Scala development environment with sbt";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    template-utils.url = "github:behaghel/nixos-config";
  };

  outputs = { self, nixpkgs, flake-utils, template-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        utils = template-utils.lib.${system}.templateUtils;
        javaVersion = pkgs.jdk17;
      in
      {
        apps = {
          run = utils.mkApp "sbt run \"$@\"";
          test = utils.mkApp "sbt test \"$@\"";
          compile = utils.mkApp "sbt compile \"$@\"";
          package = utils.mkApp "sbt assembly \"$@\"";
          console = utils.mkApp "sbt console \"$@\"";
          clean = utils.mkApp "sbt clean \"$@\"";
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

          shellHookCommands = [
            "sbt run                - Run the main application"
            "sbt test               - Run test suite"
            "sbt console            - Start Scala REPL"
            "sbt assembly           - Create fat JAR"
          ];

          extraShellHook = ''
            export JAVA_HOME=${javaVersion}
          '';
        };
      });
}