{ pkgs, lib, config, ... }:
let
  emacsBundleId = "org.gnu.Emacs";
  emacsFileUTIs = [
    "public.plain-text"
    "public.text"
    "net.daringfireball.markdown"
    "public.comma-separated-values-text"
    "public.tab-separated-values-text"
    "public.json"
    "public.yaml"
    "com.apple.log"
  ];
  emacsFileExtensions = [
    "txt"
    "text"
    "md"
    "markdown"
    "org"
    "rst"
    "tex"
    "log"
    "csv"
    "tsv"
    "json"
    "jsonl"
    "yaml"
    "yml"
    "toml"
    "ini"
    "conf"
    "cfg"
  ];
  emacsDutiConfig = ''
    # Bundle ID           UTI                             Role
    ${lib.concatMapStringsSep "\n" (uti: "${emacsBundleId}      ${uti}      all") emacsFileUTIs}
  '';

  atlassianTools = import ./atlassian-tools.nix { inherit pkgs lib; };

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
  # Prefer the macOS "MacPort" build on Darwin for better UI perf.
  # Fallback cleanly if the overlay is unavailable.
  programs.emacs = {
    enable = true;
    package = if pkgs.stdenv.isDarwin then (pkgs.emacs-29-macport or pkgs.emacs-unstable) else pkgs.emacs-unstable;
    # Install mu4e from emacsPackages (nixpkgs builds it to match pkgs.mu)
    extraPackages = epkgs: [ epkgs.mu4e ];
  };

  # Use Home Manager's built-in Emacs user service (daemon)
  services.emacs = {
    enable = true;
    package = if pkgs.stdenv.isDarwin then (pkgs.emacs-29-macport or pkgs.emacs-unstable) else pkgs.emacs-unstable;
    # Session defaults handled in modules/home/shell/default.nix
    defaultEditor = false;
  };

  # Add the setup script and Emacs runtime CLI dependencies to your environment (+ duti on Darwin)
  home.packages = [
    atlassianTools.cfl
    emacs-config-setup
  ] ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.duti ];

  xdg.configFile."duti/emacs.duti" = lib.mkIf pkgs.stdenv.isDarwin {
    text = emacsDutiConfig;
  };

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
    set -euo pipefail
    if [ ! -d "$HOME/.emacs.d" ] || [ -L "$HOME/.emacs.d" ]; then
      ${emacs-config-setup}/bin/emacs-config-setup
    fi
  '';

  home.activation.setEmacsFileAssociations = lib.mkIf pkgs.stdenv.isDarwin (lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    set -euo pipefail

    emacs_app="${config.home.homeDirectory}/Applications/Home Manager Apps/Emacs.app"
    duti_file="${config.xdg.configHome}/duti/emacs.duti"
    launch_services_plist="$HOME/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
    lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

    if [ -d "$emacs_app" ] && [ -f "$duti_file" ]; then
      if [ -x "$lsregister" ]; then
        run "$lsregister" -f "$emacs_app"
      fi

      # `duti` is reliable for real UTIs. For extension-only types that macOS
      # represents as ephemeral dyn.* UTIs, duti may call LaunchServices with an
      # invalid dynamic UTI and print error -50. Write extension handlers via
      # LSHandlerContentTag instead, which is the stable LaunchServices form.
      run ${pkgs.duti}/bin/duti "$duti_file"
      verboseEcho "Setting Emacs LaunchServices handlers for filename extensions"
      run mkdir -p "$(dirname "$launch_services_plist")"
      run ${pkgs.python3}/bin/python3 - "${emacsBundleId}" "$launch_services_plist" ${lib.concatMapStringsSep " " lib.escapeShellArg emacsFileExtensions} <<'PY'
import os
import plistlib
import sys

bundle_id = sys.argv[1]
plist_path = os.path.expanduser(sys.argv[2])
extensions = sys.argv[3:]

try:
    with open(plist_path, "rb") as f:
        data = plistlib.load(f)
except FileNotFoundError:
    data = {}

handlers = data.get("LSHandlers", [])
for ext in extensions:
    handlers = [
        handler for handler in handlers
        if not (
            handler.get("LSHandlerContentTagClass") == "public.filename-extension"
            and handler.get("LSHandlerContentTag") == ext
        )
    ]
    handlers.append({
        "LSHandlerContentTag": ext,
        "LSHandlerContentTagClass": "public.filename-extension",
        "LSHandlerRoleAll": bundle_id,
    })

data["LSHandlers"] = handlers
with open(plist_path, "wb") as f:
    plistlib.dump(data, f, sort_keys=True)
PY
    fi
  '');
}
