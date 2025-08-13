
{ pkgs, lib, config, inputs, ... }:

{
  packages = with pkgs; [
    # Pharo development tools
    pharo
    git
    curl
    unzip
    # X11 libraries for headless operation
    xvfb-run
  ];

  scripts = {
    dist.exec = ''
      echo "📦 Creating Pharo distribution..."
      if [ -f "pharo-local/Pharo.image" ]; then
        echo "Creating distribution from current image..."
        mkdir -p dist
        cp -r pharo-local/* dist/
        echo "✅ Distribution created in dist/ directory!"
      else
        echo "❌ No Pharo image found. Run 'devenv shell setup' first."
        exit 1
      fi
    '';

    format.exec = ''
      echo "🎨 Formatting Smalltalk code..."
      echo "Smalltalk formatting is typically done within the image using built-in tools."
      echo "Use the Pharo IDE's code formatter or Refactoring Browser for consistent formatting."
      echo "✅ Formatting guidance provided!"
    '';

    lint.exec = ''
      echo "🔍 Linting Smalltalk code..."
      if [ -f "pharo-local/Pharo.image" ]; then
        echo "Running code critics and lint checks..."
        xvfb-run -a pharo pharo-local/Pharo.image eval --save "
          | critique |
          critique := RBCompositeLintRule allRules.
          critique check: (RPackageOrganizer default packageNamed: 'PharoBasic').
          critique isEmpty
            ifTrue: [ 0 exit ]
            ifFalse: [ 
              critique do: [ :rule | Transcript show: rule asString; cr ].
              1 exit 
            ]
        "
        echo "✅ Linting completed!"
      else
        echo "❌ No Pharo image found. Run 'devenv shell setup' first."
        exit 1
      fi
    '';

    repl.exec = ''
      echo "🐹 Starting Pharo REPL..."
      if [ -f "pharo-local/Pharo.image" ]; then
        pharo pharo-local/Pharo.image
      else
        echo "❌ No Pharo image found. Run 'devenv shell setup' first."
        exit 1
      fi
    '';

    run.exec = ''
      echo "🚀 Running Pharo application..."
      if [ -f "pharo-local/Pharo.image" ]; then
        pharo pharo-local/Pharo.image eval "PharoBasicExample new run"
      else
        echo "❌ No Pharo image found. Run 'devenv shell setup' first."
        exit 1
      fi
    '';

    setup.exec = ''
      echo "🔧 Setting up Pharo development environment..."
      
      # Create pharo-local directory
      mkdir -p pharo-local
      cd pharo-local
      
      # Download latest stable Pharo image if not exists
      if [ ! -f "Pharo.image" ]; then
        echo "📥 Downloading Pharo image..."
        curl -L https://get.pharo.org/64/stable+vm | bash
        echo "✅ Pharo image downloaded!"
      fi
      
      cd ..
      echo "✅ Pharo environment setup completed!"
    '';
  };

  enterShell = ''
    # Initialize project if not already initialized
    if [ ! -f "src/PharoBasic/PharoBasicExample.class.st" ]; then
      echo "🚀 Bootstrapping new Pharo project..."

      # Copy template resources to project root
      if [ -d "template-resources" ]; then
        echo "📁 Copying template files..."
        cp -r template-resources/* .
        rm -rf template-resources
        echo "  ✓ Template files copied and template-resources cleaned up"
      fi

      # Setup Pharo environment
      echo "🔧 Setting up Pharo environment..."
      mkdir -p pharo-local
      cd pharo-local
      
      if [ ! -f "Pharo.image" ]; then
        echo "📥 Downloading Pharo image..."
        curl -L https://get.pharo.org/64/stable+vm | bash
      fi
      
      cd ..

      # Load project code into image
      echo "📚 Loading project code into Pharo image..."
      xvfb-run -a pharo pharo-local/Pharo.image eval --save "
        | repo packages |
        repo := TonelRepository new
          directory: '.' asFileReference;
          yourself.
        packages := repo packageNames.
        packages do: [ :packageName |
          repo loadPackageNamed: packageName
        ].
        Smalltalk saveSession.
      "

      echo "🔧 Initializing Git repository..."
      git init
      git add .
      git commit -m "Initial commit from pharo-basic template"

      echo "✅ Project bootstrapped successfully!"
      echo ""
    fi

    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "${config.env.GREETING}"
    fi
  '';

  env = {
    GREETING = ''
🐹 Pharo Smalltalk Development Environment
==========================================

Available commands:
  devenv test           - Run test suite headlessly
  devenv shell run      - Run the main application
  devenv shell setup    - Download/setup Pharo image
  devenv shell format   - Display formatting guidelines
  devenv shell lint     - Run code critics and lint checks
  devenv shell dist     - Create distribution package
  devenv shell repl     - Start Pharo IDE

Project structure:
  src/PharoBasic/       - Main package source code
  tests/PharoBasic/     - Test package source code
  pharo-local/          - Local Pharo image and VM

Environment ready!'';
  };

  # Use devenv's built-in test functionality
  enterTest = ''
    echo "🧪 Running Pharo test suite headlessly..."
    if [ -f "pharo-local/Pharo.image" ]; then
      xvfb-run -a pharo pharo-local/Pharo.image test --junit-xml-output "PharoBasic.*"
      echo "✅ Tests completed!"
    else
      echo "❌ No Pharo image found. Run 'devenv shell setup' first."
      exit 1
    fi
  '';
}
