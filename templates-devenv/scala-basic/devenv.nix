
{ pkgs, lib, config, inputs, ... }:

{
  languages.scala = {
    enable = true;
    package = pkgs.scala_3;
  };

  languages.java = {
    enable = true;
    jdk.package = pkgs.jdk17;
  };

  packages = with pkgs; [
    sbt
    scalafmt
    metals
    coursier
  ];

  scripts = {
    build.exec = ''
      echo "🔧 Compiling Scala project..."
      sbt compile
      echo "✅ Project setup complete!"
    '';

    check.exec = ''
      echo "🧪 Running test suite..."
      sbt test
      echo "✅ Tests completed!"
    '';

    install.exec = ''
      echo "📦 Building fat JAR..."
      sbt assembly
      echo "✅ Packages built successfully!"
    '';

    run.exec = ''
      echo "🚀 Running application..."
      sbt run "$@"
    '';

    format.exec = ''
      echo "🎨 Formatting code..."
      sbt scalafmt
      echo "✅ Code formatted!"
    '';

    console.exec = ''
      echo "🔍 Starting Scala REPL..."
      sbt console
    '';

    clean.exec = ''
      echo "🧹 Cleaning build artifacts..."
      sbt clean
      echo "✅ Clean completed!"
    '';
  };

  enterShell = ''
    echo "⚡ Scala Development Environment"
    echo "=================================="
    echo ""
    echo "Standard devenv commands:"
    echo "  devenv shell build    - Install dependencies and setup project"
    echo "  devenv shell check    - Run test suite"
    echo "  devenv shell install  - Build fat JAR for distribution"
    echo ""
    echo "Development commands:"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell format   - Format code with Scalafmt"
    echo "  devenv shell console  - Start Scala REPL"
    echo "  devenv shell clean    - Clean build artifacts"
    echo ""
    echo "Build tool commands:"
    echo "  sbt compile          - Compile the project"
    echo "  sbt test             - Run test suite"
    echo "  sbt assembly         - Create fat JAR"
    echo ""
    echo "Environment ready! Run 'devenv shell build' to get started."
  '';
}
