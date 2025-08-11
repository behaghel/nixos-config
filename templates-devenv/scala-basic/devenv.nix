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

    lint.exec = ''
      echo "🔍 Checking code format..."
      sbt scalafmtCheck
      echo "✅ Format check completed!"
    '';

    repl.exec = ''
      echo "⚡ Starting Scala REPL..."
      sbt console
    '';

    clean.exec = ''
      echo "🧹 Cleaning build artifacts..."
      sbt clean
      echo "✅ Clean completed!"
    '';
  };

  enterShell = ''
    # Auto-bootstrap project if needed
    if [ ! -f "build.sbt" ]; then
      echo "🚀 Bootstrapping new Scala project..."
      sbt new scala/scala3.g8 --name=scala-basic --organization=com.example
      echo "✅ Scala project bootstrapped!"
      echo ""
    fi

    # Only show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "⚡ Scala Basic Development Environment"
      echo "====================================="
      echo ""
      echo "Available commands:"
      echo "  devenv test           - Run test suite with ScalaTest"
      echo "  devenv shell run      - Run the main application"
      echo "  devenv shell repl     - Start Scala REPL"
      echo "  devenv shell format   - Format code with Scalafmt"  
      echo "  devenv shell lint     - Check formatting with Scalafmt"
      echo "  devenv shell dist     - Build fat JAR"
      echo "  sbt <command>         - Execute sbt commands"
      echo ""
      echo "Environment ready!"
    fi
  '';

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    sbt test
    echo "✅ Tests completed!"
  '';
}