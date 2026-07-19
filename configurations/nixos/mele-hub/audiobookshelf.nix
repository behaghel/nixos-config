{ config, lib, ... }:

let
  cfg = config.hub.mele.audiobookshelf;
  syncthingDeviceName = "F2400216";
  syncthingDeviceId = "YYWF4HQ-TVGYEVA-Q4PAXSQ-K27XEW2-A54UPIN-JCQTWOR-ALVT6ET-U6LD4A4";
in
{
  options.hub.mele.audiobookshelf = {
    enable = lib.mkEnableOption "Audiobookshelf on MeLE";

    domain = lib.mkOption {
      type = lib.types.str;
      default = "listen.home.behaghel.org";
      description = "Hostname served by Caddy for Audiobookshelf.";
    };

    libraryPath = lib.mkOption {
      type = lib.types.str;
      default = "/srv/syncthing/Audiobooks";
      description = "Audiobook library path scanned by Audiobookshelf.";
    };

    syncthing.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether to declare the Audiobooks Syncthing folder.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.audiobookshelf = {
      enable = true;
      host = "127.0.0.1";
      port = 8000;
      openFirewall = false;
    };

    users.users.audiobookshelf.extraGroups = lib.mkIf cfg.syncthing.enable [ "syncthing" ];

    services.syncthing.settings = lib.mkIf cfg.syncthing.enable {
      devices.${syncthingDeviceName}.id = syncthingDeviceId;
      folders.Audiobooks = {
        id = "audiobooks";
        label = "Audiobooks";
        path = cfg.libraryPath;
        type = "sendreceive";
        devices = [ syncthingDeviceName ];
        # Keep local permissions controlled by MeLE/Syncthing instead of
        # importing restrictive mode bits from the sender.
        ignorePerms = true;
        versioning = null;
      };
    };

    systemd.services.syncthing.serviceConfig.UMask = lib.mkIf cfg.syncthing.enable "0007";

    systemd.tmpfiles.rules = lib.mkIf cfg.syncthing.enable [
      "d ${cfg.libraryPath} 2770 syncthing syncthing -"
      "z ${cfg.libraryPath} 2770 syncthing syncthing -"
    ];

    services.caddy.virtualHosts.${cfg.domain}.extraConfig = ''
      encode zstd gzip
      reverse_proxy 127.0.0.1:${toString config.services.audiobookshelf.port}
    '';
  };
}
