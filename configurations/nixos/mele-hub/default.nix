{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
  me = (import ../../../config.nix).me;
  syncthingDataDir = "/srv/syncthing";
  syncthingConfigDir = "/var/lib/syncthing";
  ccidNoKobil = pkgs.ccid.overrideAttrs (old: {
    # Drop the Kobil mIDentity helper call to avoid failing the udev absolute-path check.
    postInstall = (old.postInstall or "") + ''
      sed -i '/Kobil_mIDentity_switch/d' \
        "$out/lib/udev/rules.d/92_pcscd_ccid.rules"
    '';
  });
  grafanaDashboardsPath = pkgs.linkFarm "grafana-dashboards" {
    "mele-hub-health.json" = ./grafana/health.json;
    "syncthing-restic.json" = ./grafana/syncthing-restic.json;
  };
  resticExcludes = pkgs.writeText "restic-syncthing-excludes.txt" ''
    **/.stversions/**
  '';
  resticBackupScript = pkgs.writeShellScript "restic-backup-syncthing.sh" ''
    set -euo pipefail
    if [ ! -f /etc/restic.env ]; then
      echo "restic env file missing: /etc/restic.env" >&2
      exit 1
    fi
    set -a
    source /etc/restic.env
    set +a
    ${pkgs.coreutils}/bin/mkdir -p /var/cache/restic /var/lib/node_exporter/textfile_collector
    start_ts=$(${pkgs.coreutils}/bin/date +%s)
    status=0
    if ! ${pkgs.restic}/bin/restic --verbose backup ${syncthingDataDir} --exclude-file=${resticExcludes} --tag mele-hub --cleanup-cache; then
      status=1
    fi
    if ! ${pkgs.restic}/bin/restic --verbose forget --keep-daily 4 --keep-weekly 4 --keep-monthly 12 --prune; then
      status=1
    fi
    end_ts=$(${pkgs.coreutils}/bin/date +%s)
    duration=$((end_ts - start_ts))
    cat > /var/lib/node_exporter/textfile_collector/restic.prom <<EOF
# HELP restic_last_backup_timestamp Unix time of last restic backup completion
# TYPE restic_last_backup_timestamp gauge
restic_last_backup_timestamp ''${end_ts}
# HELP restic_last_backup_status 0=success,1=failure
# TYPE restic_last_backup_status gauge
restic_last_backup_status ''${status}
# HELP restic_backup_duration_seconds Duration of last restic backup+prune
# TYPE restic_backup_duration_seconds gauge
restic_backup_duration_seconds ''${duration}
EOF
    exit ''${status}
  '';
  resticHelper = pkgs.writeShellScriptBin "bkp" ''
    set -euo pipefail
    if [ ! -f /etc/restic.env ]; then
      echo "restic env file missing: /etc/restic.env" >&2
      exit 1
    fi
    set -a
    source /etc/restic.env
    set +a
    exec ${pkgs.restic}/bin/restic "$@"
  '';
in
{
  imports = [
    self.nixosModules.default
    ./hardware-configuration.nix
  ];

  # Alerting rules
  alertsFile = pkgs.writeText "prometheus-alerts.yml" ''
    groups:
      - name: mele-hub
        rules:
          - alert: ResticBackupStale
            expr: time() - restic_last_backup_timestamp > 172800
            for: 10m
            labels: { severity: warning }
            annotations:
              summary: "Restic backup stale"
              description: "Last restic backup older than 48h"

          - alert: ResticBackupFailed
            expr: restic_last_backup_status == 1
            for: 10m
            labels: { severity: critical }
            annotations:
              summary: "Restic backup failing"
              description: "Restic last run exited non-zero"

          - alert: HighCPU
            expr: 1 - avg(rate(node_cpu_seconds_total{mode="idle"}[10m])) > 0.95
            for: 10m
            labels: { severity: warning }
            annotations:
              summary: "High CPU utilization"
              description: "CPU >95% for 10m"

          - alert: DiskHighUsage
            expr: (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|ramfs|autofs"} / node_filesystem_size_bytes{fstype!~"tmpfs|ramfs|autofs"}) > 0.85
            for: 15m
            labels: { severity: warning }
            annotations:
              summary: "Disk usage high"
              description: "Mount {{ $labels.mountpoint }} above 85%"

          - alert: SyncthingDown
            expr: avg_over_time(up{job="syncthing"}[5m]) < 0.5
            for: 5m
            labels: { severity: critical }
            annotations:
              summary: "Syncthing scrape down"
              description: "Syncthing metrics not responding"

          - alert: SmartctlNoMetrics
            expr: absent(up{job="smartctl"})
            for: 15m
            labels: { severity: warning }
            annotations:
              summary: "SMART exporter missing"
              description: "No smartctl metrics scraped"

          - alert: SmartctlFailing
            expr: smartctl_device_smart_healthy == 0
            for: 5m
            labels: { severity: critical }
            annotations:
              summary: "SMART reports failing drive"
              description: "Device {{ $labels.name }} SMART health failing"
  '';

  nixpkgs = {
    hostPlatform = "x86_64-linux";
    overlays = import ../../../overlays/default.nix { inherit inputs; };
    config.allowUnfree = true;
  };

  networking = {
    hostName = "mele-hub";
    networkmanager.enable = true;
    useDHCP = lib.mkDefault true;
    firewall = {
      enable = true;
      allowedTCPPorts = [ 22 22000 3000 ];
      allowedUDPPorts = [ 22000 21027 ];
      logRefusedConnections = true;
    };
  };

  time.timeZone = "UTC";
  console.keyMap = "fr-bepo";
  console.earlySetup = true;

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  hardware = {
    cpu.intel.updateMicrocode = true;
    enableRedistributableFirmware = true;
  };

  services = {
    tlp.enable = true;
    timesyncd.enable = true;
    pcscd.enable = true;
    openssh = {
      enable = true;
      settings = {
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        PermitRootLogin = "no";
        MaxAuthTries = 3;
        AllowUsers = [ me.username ];
        X11Forwarding = false;
        AllowAgentForwarding = true; # allow SSH tunnelling to Syncthing GUI
        UseDns = false;
        ClientAliveInterval = 30;
        ClientAliveCountMax = 2;
      };
      hostKeys = [
        { path = "/etc/ssh/ssh_host_ed25519_key"; type = "ed25519"; }
        { path = "/etc/ssh/ssh_host_rsa_key"; type = "rsa"; }
      ];
    };
    fail2ban.enable = true;
    smartd.enable = true;
    prometheus = {
      enable = true;
      listenAddress = "127.0.0.1";
      port = 9090;
      globalConfig.scrape_interval = "15s";
      scrapeConfigs = [
        {
          job_name = "node";
          static_configs = [
            { targets = [ "127.0.0.1:9100" ]; }
          ];
        }
        {
          job_name = "syncthing";
          static_configs = [
            { targets = [ "127.0.0.1:9091" ]; }
          ];
        }
        {
          job_name = "smartctl";
          static_configs = [
            { targets = [ "127.0.0.1:9633" ]; }
          ];
        }
      ];
      ruleFiles = [ alertsFile ];
      exporters.node = {
        enable = true;
        enabledCollectors = [ "systemd" "processes" ];
        port = 9100;
        listenAddress = "127.0.0.1";
        extraFlags = [
          "--collector.textfile.directory=/var/lib/node_exporter/textfile_collector"
        ];
      };
      exporters.smartctl = {
        enable = true;
        listenAddress = "127.0.0.1";
        port = 9633;
      };
    };
    alertmanager = {
      enable = true;
      listenAddress = "127.0.0.1";
      port = 9093;
      configuration = {
        global = {
          smtp_smarthost = "smtp.gmail.com:465";
          smtp_from = "behaghel@gmail.com";
          smtp_require_tls = true;
          smtp_auth_username = "behaghel@gmail.com";
          smtp_auth_password_file = "/etc/alertmanager-smtp-pass";
        };
        route = {
          receiver = "email";
        };
        receivers = [
          {
            name = "email";
            email_configs = [
              {
                to = "behaghel@gmail.com";
                send_resolved = true;
              }
            ];
          }
        ];
      };
    };
    grafana = {
      enable = true;
      settings = {
        server = {
          http_addr = "0.0.0.0";
          http_port = 3000;
          domain = "mele-hub";
        };
        "auth.anonymous".enabled = true;
        "auth.anonymous".org_role = "Viewer";
        auth.disable_login_form = true;
        security.admin_user = "admin";
      };
      provision = {
        enable = true;
        datasources.settings.datasources = [
          {
            name = "Prometheus";
            type = "prometheus";
            access = "proxy";
            url = "http://127.0.0.1:9090";
            isDefault = true;
            uid = "prometheus";
          }
        ];
        dashboards.settings.providers = [
          {
            name = "local-dashboards";
            options.path = grafanaDashboardsPath;
          }
        ];
      };
    };
    syncthing = {
      enable = true;
      user = "syncthing";
      group = "syncthing";
      dataDir = syncthingDataDir;
      configDir = syncthingConfigDir;
      guiAddress = "127.0.0.1:8384";
      openDefaultPorts = false;
      settings = {
        options = {
          relaysEnabled = true;
          localAnnounceEnabled = true;
          globalAnnounceEnabled = true;
          natEnabled = true;
          startBrowser = false;
          autoUpgradeIntervalH = 24;
          restartOnWakeup = true;
          urAccepted = -1; # accept upstream upgrade prompts automatically
          defaultFolderPath = syncthingDataDir;
          prometheusEnabled = true;
          prometheusAddress = "127.0.0.1:9091";
        };
      };
    };

    udev.packages = with pkgs; [
      ccidNoKobil
      lvm2
      bcache-tools
      networkmanager
      wpa_supplicant
      modemmanager
      tlp
    ];
  };

  # Override Emacs to a cached build on this host (resolve duplicate option by forcing).
  home-manager.users.hub.programs.emacs.package = lib.mkForce pkgs.emacs30;
  home-manager.users.hub.services.emacs.package = lib.mkForce pkgs.emacs30;
  # Console-friendly pinentry for YubiKey on this headless host.
  home-manager.users.hub.services.gpg-agent.pinentry.package = lib.mkForce pkgs.pinentry-tty;

  systemd.tmpfiles.rules = [
    "d ${syncthingDataDir} 0770 syncthing syncthing -"
    "d ${syncthingConfigDir} 0700 syncthing syncthing -"
    "d /var/lib/node_exporter/textfile_collector 0755 root root -"
  ];

  # Harden networking a bit for a public host
  boot.kernel.sysctl = {
    "net.ipv4.conf.all.accept_redirects" = 0;
    "net.ipv4.conf.default.accept_redirects" = 0;
    "net.ipv4.conf.all.accept_source_route" = 0;
    "net.ipv4.conf.default.accept_source_route" = 0;
    "net.ipv4.tcp_syncookies" = 1;
    "net.ipv6.conf.all.accept_redirects" = 0;
    "net.ipv6.conf.default.accept_redirects" = 0;
    "net.ipv6.conf.all.accept_source_route" = 0;
    "net.ipv6.conf.default.accept_source_route" = 0;
  };

  services.journald.storage = "persistent";

  programs.zsh.enable = true;
  environment.systemPackages = with pkgs; [
    git
    ripgrep
    fd
    eza
    bat
    jq
    curl
    restic
    resticHelper
  ];

  systemd.services.restic-backup-syncthing = {
    description = "Restic backup of /srv/syncthing";
    wantedBy = [ ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    serviceConfig = {
      Type = "oneshot";
      Nice = 10;
      IOSchedulingClass = "best-effort";
      IOSchedulingPriority = 7;
      ExecStart = [ resticBackupScript ];
    };
  };

  systemd.timers.restic-backup-syncthing = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "02:30";
      Persistent = true;
      RandomizedDelaySec = "30m";
    };
  };

  users = {
    users.hub = {
      isNormalUser = true;
      description = me.fullname;
      extraGroups = [ "wheel" "networkmanager" "syncthing" ];
      shell = pkgs.zsh;
      openssh.authorizedKeys.keys = [ me.sshKey ];
      initialHashedPassword = "!"; # locked by default; set a password after install if desired
    };
    groups.syncthing.members = [ "hub" ];
  };

  security.sudo = {
    enable = true;
    wheelNeedsPassword = false;
    execWheelOnly = true;
  };

  myusers = [ "hub" ];

  nix = {
    settings = {
      experimental-features = [ "nix-command" "flakes" ];
      auto-optimise-store = true;
      trusted-users = [ "root" "hub" ];
      substituters = lib.mkAfter [ "https://emacs.cachix.org" ];
      trusted-public-keys = lib.mkAfter [
        "emacs.cachix.org-1:TU3ITeTVpL41RDdfJnr3CGqoTrs1sCWlpPhPkG2EW7E="
      ];
    };
    gc = {
      automatic = true;
      dates = "03:15";
      options = "--delete-older-than 7d";
    };
  };

  powerManagement.cpuFreqGovernor = lib.mkDefault "powersave";
  system.stateVersion = "24.11";
}
