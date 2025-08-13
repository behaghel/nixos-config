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
    # Initialize project if not already initialized
    if [ ! -f "build.sbt" ]; then
      echo "🚀 Bootstrapping new Scala project..."
      sbt new scala/scala3.g8 --name=scala-basic --organization=com.example
      
      # Move generated files from subdirectory to root
      if [ -d "scala-basic" ]; then
        echo "📁 Moving project files to root directory..."
        cp -r scala-basic/* . 2>/dev/null || true
        cp -r scala-basic/.* . 2>/dev/null || true
        rm -rf scala-basic
        echo "  ✓ Project files moved to root and scala-basic/ cleaned up"
      fi
      
      echo "✅ Scala project bootstrapped!"
      echo ""
    fi
    
    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "$GREETING"
    fi
  '';

  env = {
    GREETING = ''
⚡ Scala Basic Development Environment
=====================================

Available commands:
  devenv test           - Run test suite with ScalaTest
  devenv shell run      - Run the main application
  devenv shell repl     - Start Scala REPL
  devenv shell format   - Format code with Scalafmt
  devenv shell lint     - Check formatting with Scalafmt
  devenv shell dist     - Build fat JAR
  sbt <command>         - Execute sbt commands

Environment ready!'';
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running test suite..."
    sbt test
    echo "✅ Tests completed!"
  '';
}