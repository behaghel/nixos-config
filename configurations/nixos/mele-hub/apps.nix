{ config, lib, pkgs, ... }:

let
  cfg = config.services.meleApps;

  appUser = name: "app-${name}";

  appTmpfiles = name: app:
    let
      user = appUser name;
    in
    [
      "d /srv/apps/${name} 0751 ${user} ${user} -"
      "d /srv/apps/${name}/data 0750 ${user} ${user} -"
      "d /srv/apps/${name}/state 0755 root root -"
    ];

  appFiles = lib.filterAttrs
    (name: type: type == "regular" && lib.hasSuffix ".nix" name)
    (builtins.readDir ./apps);

  appSlots = lib.mapAttrs'
    (fileName: _:
      lib.nameValuePair (lib.removeSuffix ".nix" fileName) (import (./apps + "/${fileName}")))
    appFiles;

  appServiceScript = name: app:
    pkgs.writeShellScript "mele-app-${name}-run" ''
      set -euo pipefail
      env_args=()
      if [ -f /etc/mele-apps/${name}.env ]; then
        env_args+=(--env-file /etc/mele-apps/${name}.env)
      fi
      exec ${pkgs.podman}/bin/podman run \
        --rm \
        --replace \
        --name mele-app-${name} \
        --userns=keep-id \
        --cap-drop=all \
        --security-opt=no-new-privileges \
        --pids-limit=512 \
        --publish 127.0.0.1:${toString app.hostPort}:${toString app.containerPort} \
        --volume /srv/apps/${name}/data:/data:Z \
        --env APP_DATA_DIR=/data \
        "''${env_args[@]}" \
        localhost/${name}:current
    '';

  meleAppCli = pkgs.writeShellApplication {
    name = "mele-app";
    runtimeInputs = [
      pkgs.podman
      pkgs.systemd
      pkgs.util-linux
    ];
    text = ''
      exec ${pkgs.python3}/bin/python3 ${../../../scripts/mele_app_cli.py} "$@"
    '';
  };

  appRuntimePath = lib.makeBinPath [
    pkgs.podman
    pkgs.shadow
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.gnused
    pkgs.systemd
  ];

  appService = name: app: {
    description = "MeLE app ${name}";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = [ pkgs.podman ];
    serviceConfig = {
      User = appUser name;
      Group = appUser name;
      WorkingDirectory = "/srv/apps/${name}";
      RuntimeDirectory = "mele-app-${name}";
      Environment = [
        "XDG_RUNTIME_DIR=/run/mele-app-${name}"
        "PATH=/run/wrappers/bin:${appRuntimePath}"
      ];
      ExecCondition = "${pkgs.podman}/bin/podman image exists localhost/${name}:current";
      ExecStartPre = [ "-${pkgs.podman}/bin/podman rm -f mele-app-${name}" ];
      ExecStart = appServiceScript name app;
      Restart = "on-failure";
      RestartSec = "5s";
      TimeoutStartSec = "60s";
      # Rootless Podman needs setuid newuidmap/newgidmap during namespace setup.
      # Keep no-new-privileges inside the container instead.
      PrivateTmp = true;
      ProtectSystem = "strict";
      ReadWritePaths = [
        "/srv/apps/${name}"
        "/run/mele-app-${name}"
        "/tmp"
      ];
    };
  };

  appUsers =
    lib.listToAttrs (lib.imap0
      (index: name:
        lib.nameValuePair (appUser name) {
          isSystemUser = true;
          group = appUser name;
          home = "/srv/apps/${name}";
          createHome = false;
          subUidRanges = [{
            startUid = 200000 + (index * 65536);
            count = 65536;
          }];
          subGidRanges = [{
            startGid = 200000 + (index * 65536);
            count = 65536;
          }];
        })
      (lib.attrNames cfg.apps));

  caddyVirtualHost = _name: app: {
    extraConfig = ''
      encode zstd gzip
      request_body {
        max_size ${app.edge.maxBodySize}
      }
      reverse_proxy 127.0.0.1:${toString app.hostPort} {
        transport http {
          dial_timeout ${app.edge.dialTimeout}
          response_header_timeout ${app.edge.responseHeaderTimeout}
        }
      }
      handle_errors {
        respond "App unavailable" {err.status_code}
      }
    '';
  };

  sanitizePrometheusName = name:
    lib.replaceStrings [ "." "_" ] [ "-" "-" ]
      (lib.strings.sanitizeDerivationName name);

  prometheusScrapeConfig = name: app: {
    job_name = "mele-app-${sanitizePrometheusName name}";
    metrics_path = app.metrics.path;
    static_configs = [
      {
        targets = [ "127.0.0.1:${toString app.hostPort}" ];
        labels = {
          app = name;
          domain = app.domain;
        };
      }
    ];
  };

  appToJson = name: app: {
    inherit name;
    inherit (app) domain exposure hostPort containerPort healthPath keepReleases backup;
    user = appUser name;
    group = appUser name;
    serviceName = "mele-app-${name}.service";
    envFile = "/etc/mele-apps/${name}.env";
    dataDir = "/srv/apps/${name}/data";
    stateDir = "/srv/apps/${name}/state";
    metricsTextfile = "/var/lib/node_exporter/textfile_collector/mele_app_${name}.prom";
    secretspec = {
      profile = app.secretspec.profile;
      path = "/srv/apps/${name}/state/secretspec.toml";
    };
    metrics = {
      inherit (app.metrics) enable path;
    };
    contract = {
      writeProbe = {
        inherit (app.contract.writeProbe) enable path method contentType bodySize;
      };
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

          edge = {
            maxBodySize = lib.mkOption {
              type = lib.types.str;
              default = "10MiB";
              description = "Maximum request body size accepted by Caddy.";
            };

            dialTimeout = lib.mkOption {
              type = lib.types.str;
              default = "5s";
              description = "Caddy reverse proxy dial timeout for this app.";
            };

            responseHeaderTimeout = lib.mkOption {
              type = lib.types.str;
              default = "30s";
              description = "Caddy timeout waiting for app response headers.";
            };
          };

          contract.writeProbe = {
            enable = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether contract-check probes oversized writes.";
            };

            path = lib.mkOption {
              type = lib.types.str;
              default = "/";
              description = "HTTP path used by the oversized write probe.";
            };

            method = lib.mkOption {
              type = lib.types.str;
              default = "POST";
              description = "HTTP method used by the oversized write probe.";
            };

            contentType = lib.mkOption {
              type = lib.types.str;
              default = "application/json";
              description = "Content-Type used by the oversized write probe.";
            };

            bodySize = lib.mkOption {
              type = lib.types.str;
              default = "11MiB";
              description = "Payload size sent by the oversized write probe.";
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
        apps = appSlots;
      };
    }

    (lib.mkIf cfg.enable {
      environment.etc."mele-apps/config.json".text = builtins.toJSON {
        baseDomain = cfg.baseDomain;
        apps = lib.mapAttrs appToJson cfg.apps;
      };

      services.prometheus.scrapeConfigs = lib.mapAttrsToList prometheusScrapeConfig
        (lib.filterAttrs (_name: app: app.metrics.enable) cfg.apps);

      networking.firewall.allowedTCPPorts = [ 80 443 ];

      environment.systemPackages = [ meleAppCli ];

      virtualisation.podman.enable = true;

      services.caddy = {
        enable = true;
        virtualHosts = (lib.mapAttrs'
          (_name: app:
            lib.nameValuePair app.domain (caddyVirtualHost _name app))
          cfg.apps) // {
          ":80".extraConfig = ''
            respond "Not found" 404
          '';
        };
      };

      systemd.services = lib.mapAttrs'
        (name: app:
          lib.nameValuePair "mele-app-${name}" (appService name app))
        cfg.apps;

      systemd.tmpfiles.rules = [
        "d /etc/mele-apps 0755 root root -"
        "d /srv/apps 0755 root root -"
      ] ++ lib.concatLists (lib.mapAttrsToList appTmpfiles cfg.apps);

      users.groups = lib.mapAttrs'
        (name: _app:
          lib.nameValuePair (appUser name) { })
        cfg.apps;

      users.users = appUsers;
    })
  ];
}
