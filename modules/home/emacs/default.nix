
{ pkgs, flake, ... }:
let
  inherit (flake) inputs;
  
  # Script to sync your external config to ~/.emacs.d
  emacs-config-sync = pkgs.writeShellScriptBin "emacs-config-sync" ''
    echo "Syncing Emacs configuration from flake input..."
    
    # Create backup if .emacs.d exists and is not a symlink
    if [ -d "$HOME/.emacs.d" ] && [ ! -L "$HOME/.emacs.d" ]; then
      echo "Backing up existing .emacs.d to .emacs.d.backup"
      mv "$HOME/.emacs.d" "$HOME/.emacs.d.backup"
    fi
    
    # Remove old symlink if it exists
    if [ -L "$HOME/.emacs.d" ]; then
      rm "$HOME/.emacs.d"
    fi
    
    # Copy config to make it writable
    cp -r "${inputs.my-emacs-config}" "$HOME/.emacs.d"
    chmod -R u+w "$HOME/.emacs.d"
    
    echo "Emacs configuration synced! Your .emacs.d is now writable."
    echo "Run this command again to pull updates from your config repo."
  '';
in
{
  programs.emacs = {
    enable = true;
    package = pkgs.emacs-unstable;
    extraPackages = epkgs: [ epkgs.mu4e ];
  };

  # Add the sync script to your environment
  home.packages = [ emacs-config-sync ];

  # Optionally auto-sync on activation (comment out if you prefer manual control)
  home.activation.syncEmacsConfig = ''
    if [ ! -d "$HOME/.emacs.d" ] || [ -L "$HOME/.emacs.d" ]; then
      ${emacs-config-sync}/bin/emacs-config-sync
    fi
  '';
}
