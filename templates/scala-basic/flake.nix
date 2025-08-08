{
  description = "Scala development environment with sbt";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    template-utils.url = "github:behaghel/nixos-config";
  };

  outputs = { self, nixpkgs, template-utils }:
    nixpkgs.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        utils = template-utils.lib.${system}.templateUtils;
        javaVersion = pkgs.jdk17;
      in
      {
        apps = {
          run = utils.mkApp "sbt run \"$@\"" pkgs;
          test = utils.mkApp "sbt test \"$@\"" pkgs;
          compile = utils.mkApp "sbt compile \"$@\"" pkgs;
          package = utils.mkApp "sbt assembly \"$@\"" pkgs;
          console = utils.mkApp "sbt console \"$@\"" pkgs;
          clean = utils.mkApp "sbt clean \"$@\"" pkgs;
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
        } pkgs;
      });
}