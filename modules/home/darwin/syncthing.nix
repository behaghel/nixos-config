{ config, pkgs, lib, ... }:
with lib;

let
  cfg = config.hub.syncthing;
in
{
  options.hub.syncthing = {
    enable = mkEnableOption "Syncthing (launchd-managed) on macOS";

    dataDir = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/Sync";
      description = "Root directory for Syncthing folders on this machine.";
    };

    guiAddress = mkOption {
      type = types.str;
      default = "127.0.0.1:8384";
      description = "Address the GUI listens on; keep loopback for safety.";
    };
  };

  config = mkIf (cfg.enable && pkgs.stdenv.isDarwin) {
    home.packages = [ pkgs.syncthing ];

    # launchd agent to run Syncthing in user session
    launchd.agents.syncthing = {
      enable = true;
      config =
        let
          script = pkgs.writeShellScript "syncthing-launch.sh" ''
            set -euo pipefail
            export PATH=${lib.makeBinPath [ pkgs.syncthing pkgs.coreutils pkgs.gnugrep pkgs.gnused pkgs.findutils ]}:/usr/bin:/bin:/usr/sbin:/sbin
            DATA_DIR=${cfg.dataDir}
            HOME_DIR=${config.home.homeDirectory}
            CONFIG_DIR="$HOME_DIR/Library/Application Support/Syncthing"
            LOG_DIR="$HOME_DIR/Library/Logs"
            mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"
            exec syncthing serve \
              --home "$CONFIG_DIR" \
              --gui-address "http://${cfg.guiAddress}" \
              --log-file "$LOG_DIR/syncthing.log"
          '';
        in {
          Label = "org.nixos.syncthing";
          ProgramArguments = [ (toString script) ];
          KeepAlive = true;
          RunAtLoad = true;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/syncthing.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/syncthing.log";
        };
    };
  };
}
