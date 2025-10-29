{ pkgs, lib, ... }:
let
  # Script to set up Emacs configuration by cloning from GitHub
  emacs-config-setup = pkgs.writeShellApplication {
    name = "emacs-config-setup";
    runtimeInputs = [ pkgs.git ];
    text = ''
    set -e  # Exit immediately on any error
    
    EMACS_CONFIG_REPO="https://github.com/behaghel/.emacs.d.git"
    
    echo "=== Setting up Emacs configuration ==="
    
    # If .emacs.d already exists and is a directory (not symlink), assume it's set up
    if [ -d "$HOME/.emacs.d" ] && [ ! -L "$HOME/.emacs.d" ]; then
      echo "✓ Emacs configuration already exists at ~/.emacs.d"
      
      # Check if it's a git repository and offer to pull updates
      if [ -d "$HOME/.emacs.d/.git" ]; then
        echo "Checking for updates..."
        cd "$HOME/.emacs.d"
        if git fetch --dry-run 2>/dev/null; then
          echo "✓ Repository is accessible, you can run 'git pull' to update"
        fi
      fi
      exit 0
    fi
    
    # Remove old symlink if it exists
    if [ -L "$HOME/.emacs.d" ]; then
      echo "Removing existing symlink"
      rm "$HOME/.emacs.d"
      echo "✓ Symlink removed"
    fi
    
    # Clone the configuration repository
    echo "Cloning Emacs configuration from $EMACS_CONFIG_REPO..."
    if ! git clone "$EMACS_CONFIG_REPO" "$HOME/.emacs.d"; then
      echo "ERROR: Failed to clone configuration repository!"
      echo "Make sure you have access to $EMACS_CONFIG_REPO"
      echo "SETUP FAILED"
      exit 1
    fi
    echo "✓ Configuration cloned"
    
    echo ""
    echo "🎉 SETUP SUCCESSFUL!"
    echo "Your Emacs configuration is ready at ~/.emacs.d"
    echo "- Configuration is fully writable and git-managed"
    echo "- Use 'git pull' in ~/.emacs.d to get updates"
    echo "- Use 'git push' to save your changes"
    '';
  };
in
{
  programs.emacs = {
    enable = true;
    package = pkgs.emacs-unstable;
    # Install mu4e from emacsPackages (nixpkgs builds it to match pkgs.mu)
    extraPackages = epkgs: [ epkgs.mu4e ];
  };

  # Use Home Manager's built-in Emacs user service (daemon)
  services.emacs = {
    enable = true;
    package = pkgs.emacs-unstable;
    # Session defaults handled in modules/home/shell/default.nix
    defaultEditor = false;
  };

  # Add the setup script to your environment
  home.packages = [ emacs-config-setup ];

  # Install desktop entries on Linux platforms only
  xdg.desktopEntries = lib.mkIf pkgs.stdenv.isLinux {
    emacs = {
      name = "GNU Emacs";
      genericName = "Text Editor";
      comment = "Edit text";
      exec = "emacs %F";
      icon = "emacs";
      type = "Application";
      terminal = false;
      startupNotify = true;
      categories = [ "Development" "TextEditor" ];
      mimeType = [
        "text/english"
        "text/plain"
        "text/x-makefile"
        "text/x-c++hdr"
        "text/x-c++src"
        "text/x-chdr"
        "text/x-csrc"
        "text/x-java"
        "text/x-moc"
        "text/x-pascal"
        "text/x-tcl"
        "text/x-tex"
        "application/x-shellscript"
        "text/x-c"
        "text/x-c++"
      ];
    };

    emacsclient = {
      name = "Emacs Client";
      genericName = "Text Editor";
      comment = "Edit text using a running Emacs server";
      exec = "emacsclient -c -a \"\" %F";
      icon = "emacs";
      type = "Application";
      terminal = false;
      startupNotify = true;
      categories = [ "Development" "Utility" "TextEditor" ];
      mimeType = [ "text/plain" ];
    };
  };

  # Auto-setup on activation if .emacs.d doesn't exist
  home.activation.setupEmacsConfig = ''
    if [ ! -d "$HOME/.emacs.d" ] || [ -L "$HOME/.emacs.d" ]; then
      ${emacs-config-setup}/bin/emacs-config-setup
    fi
  '';
}
