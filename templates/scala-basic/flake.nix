{
  description = "Scala development environment with sbt";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    template-utils.url = "github:behaghel/nixos-config#lib.templateUtils";
  };

  outputs = { self, nixpkgs, template-utils }:
    {
      perSystem = { system, ... }:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          javaVersion = pkgs.jdk17;
        in
        {
          apps = {
            run = template-utils.mkApp "sbt run \"$@\"" pkgs;
            test = template-utils.mkApp "sbt test \"$@\"" pkgs;
            compile = template-utils.mkApp "sbt compile \"$@\"" pkgs;
            package = template-utils.mkApp "sbt assembly \"$@\"" pkgs;
            console = template-utils.mkApp "sbt console \"$@\"" pkgs;
            clean = template-utils.mkApp "sbt clean \"$@\"" pkgs;
          };

          devShells.default = template-utils.mkDevShell
            {
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
            }
            pkgs;
        };
    };
}
