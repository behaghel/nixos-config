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
    dist.exec = ''
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
    echo "Available commands:"
    echo "  devenv test           - Run test suite"
    echo "  devenv shell dist     - Build fat JAR for distribution"
    echo "  devenv shell run      - Run the main application"
    echo "  devenv shell format   - Format code with Scalafmt"
    echo "  devenv shell console  - Start Scala REPL"
    echo "  devenv shell clean    - Clean build artifacts"
    echo ""
    echo "Environment ready!"
  '';

  # Use devenv's built-in test functionality
  test = ''
    echo "🧪 Running test suite..."
    sbt test
    echo "✅ Tests completed!"
  '';
}