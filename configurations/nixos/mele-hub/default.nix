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
in
{
  imports = [
    self.nixosModules.default
    ./hardware-configuration.nix
  ];

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
      allowedTCPPorts = [ 22 22000 ];
      allowedUDPPorts = [ 22000 21027 ];
      logRefusedConnections = true;
    };
  };

  time.timeZone = "UTC";

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  hardware = {
    cpu.intel.updateMicrocode = true;
    enableRedistributableFirmware = true;
  };

  services = {
    tlp.enable = true;
    timesyncd.enable = true;
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

  systemd.tmpfiles.rules = [
    "d ${syncthingDataDir} 0770 syncthing syncthing -"
    "d ${syncthingConfigDir} 0700 syncthing syncthing -"
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
