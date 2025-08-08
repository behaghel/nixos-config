
{ pkgs, lib, ... }:

pkgs.stdenv.mkDerivation {
  name = "test-templates";
  
  src = ./.;
  
  nativeBuildInputs = with pkgs; [
    nix
    git
  ];
  
  buildPhase = ''
    # Set up a temporary directory for testing
    export HOME=$(mktemp -d)
    export NIX_CONFIG="experimental-features = nix-command flakes read-only-local-store local-overlay-store"
    
    # Test python-basic template
    echo "Testing python-basic template..."
    
    # Create a test project from the template
    nix flake new test-python-project --template ${./..}#python-basic
    cd test-python-project
    
    # Check required files exist
    required_files=(
      "flake.nix"
      "pyproject.toml"
      ".envrc" 
      ".editorconfig"
      ".pre-commit-config.yaml"
      "README.md"
      "src/python_basic/__init__.py"
      "src/python_basic/main.py"
      "tests/__init__.py"
      "tests/test_main.py"
    )
    
    for file in "''${required_files[@]}"; do
      if [[ ! -f "$file" ]]; then
        echo "ERROR: Required file $file is missing"
        exit 1
      fi
    done
    echo "✓ All required files present"
    
    # Test that nix develop works
    nix develop --command python --version
    if [[ $? -ne 0 ]]; then
      echo "ERROR: nix develop failed"
      exit 1
    fi
    echo "✓ Nix develop environment works"
    
    # Test build command works
    nix develop --command bash -c "build"
    if [[ $? -ne 0 ]]; then
      echo "ERROR: build command failed"
      exit 1
    fi
    echo "✓ Build command works"
    
    # Test that tests can run
    nix develop --command bash -c "test"
    if [[ $? -ne 0 ]]; then
      echo "ERROR: test command failed"
      exit 1
    fi
    echo "✓ Test command works"
    
    # Test main module can run
    output=$(nix develop --command bash -c "run python -m python_basic.main")
    if [[ $? -ne 0 ]] || [[ ! "$output" =~ "Hello, World!" ]]; then
      echo "ERROR: main module failed or output incorrect"
      echo "Output: $output"
      exit 1
    fi
    echo "✓ Main module runs correctly"
    
    # Test package command works
    nix develop --command bash -c "package"
    if [[ $? -ne 0 ]] || [[ ! -d "dist" ]]; then
      echo "ERROR: package command failed or dist directory not created"
      exit 1
    fi
    echo "✓ Package command works"
    
    echo "All template tests passed!"
  '';
  
  installPhase = ''
    mkdir -p $out
    echo "Template tests completed successfully" > $out/result
  '';
  
  meta = with lib; {
    description = "Validation tests for project templates";
    maintainers = [ ];
  };
}
