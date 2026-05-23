{ config, lib, ... }:

let
  cfg = config.services.meleApps;

  appUser = name: "app-${name}";

  appTmpfiles = name: app:
    let
      user = appUser name;
    in
    [
      "d /srv/apps/${name} 0750 ${user} ${user} -"
      "d /srv/apps/${name}/data 0750 ${user} ${user} -"
      "d /srv/apps/${name}/state 0750 ${user} ${user} -"
    ];

  appToJson = name: app: {
    inherit name;
    inherit (app) domain exposure hostPort containerPort healthPath keepReleases backup;
    user = appUser name;
    group = appUser name;
    serviceName = "mele-app-${name}.service";
    envFile = "/etc/mele-apps/${name}.env";
    dataDir = "/srv/apps/${name}/data";
    stateDir = "/srv/apps/${name}/state";
    secretspec = {
      profile = app.secretspec.profile;
      path = "/srv/apps/${name}/state/secretspec.toml";
    };
    metrics = {
      inherit (app.metrics) enable path;
    };
  };
in
{
  options.services.meleApps = {
    enable = lib.mkEnableOption "MeLE app hosting platform";

    baseDomain = lib.mkOption {
      type = lib.types.str;
      default = "home.behaghel.org";
      description = "Base DNS domain for public MeLE apps.";
    };

    apps = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ name, ... }: {
        options = {
          domain = lib.mkOption {
            type = lib.types.str;
            default = "${name}.${cfg.baseDomain}";
            description = "HTTP hostname routed to this app.";
          };

          exposure = lib.mkOption {
            type = lib.types.enum [ "public" "lan" ];
            default = "lan";
            description = "Whether this app is intended for public or LAN-only exposure.";
          };

          hostPort = lib.mkOption {
            type = lib.types.port;
            description = "Localhost TCP port Caddy uses to reach the app.";
          };

          containerPort = lib.mkOption {
            type = lib.types.port;
            default = 8080;
            description = "TCP port exposed by the app inside its container.";
          };

          healthPath = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Optional HTTP path used for deploy health checks.";
          };

          keepReleases = lib.mkOption {
            type = lib.types.ints.positive;
            default = 5;
            description = "Number of successful image releases to keep for rollback.";
          };

          backup = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Whether app data and state should be included in MeLE backups.";
          };

          secretspec.profile = lib.mkOption {
            type = lib.types.str;
            default = "prod";
            description = "SecretSpec profile whose keys must be present in the host env file.";
          };

          metrics = {
            enable = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether Prometheus should scrape this app.";
            };

            path = lib.mkOption {
              type = lib.types.str;
              default = "/metrics";
              description = "HTTP metrics path exposed by the app.";
            };
          };
        };
      }));
      default = { };
      description = "Declarative app slots hosted on MeLE.";
    };
  };

  config = lib.mkMerge [
    {
      services.meleApps = {
        enable = true;
        baseDomain = "home.behaghel.org";
        apps.home = {
          domain = "home.behaghel.org";
          exposure = "public";
          hostPort = 8101;
          containerPort = 8080;
          healthPath = "/health";
          metrics = {
            enable = true;
            path = "/metrics";
          };
        };
      };
    }

    (lib.mkIf cfg.enable {
      environment.etc."mele-apps/config.json".text = builtins.toJSON {
        baseDomain = cfg.baseDomain;
        apps = lib.mapAttrs appToJson cfg.apps;
      };

      systemd.tmpfiles.rules = [
        "d /etc/mele-apps 0755 root root -"
        "d /srv/apps 0755 root root -"
      ] ++ lib.concatLists (lib.mapAttrsToList appTmpfiles cfg.apps);

      users.groups = lib.mapAttrs' (name: _app:
        lib.nameValuePair (appUser name) { }) cfg.apps;

      users.users = lib.mapAttrs' (name: _app:
        lib.nameValuePair (appUser name) {
          isSystemUser = true;
          group = appUser name;
          home = "/srv/apps/${name}";
          createHome = false;
        }) cfg.apps;
    })
  ];
}
