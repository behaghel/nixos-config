{ lib, pkgs, ... }:

{
  # Generic VM baseline
  boot.loader = {
    systemd-boot.enable = true;
    efi.canTouchEfiVariables = true;
  };
  boot.kernelParams = [ "console=ttyS0" ];
  boot.growPartition = true;
  boot.initrd.availableKernelModules = [ "virtio_pci" "virtio_blk" "virtio_scsi" ];

  networking.hostName = "builder-x86";
  time.timeZone = "UTC";

  services.qemuGuest.enable = true;
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
      KbdInteractiveAuthentication = false;
      LogLevel = "VERBOSE";
    };
  };

  # Allow the host to connect for builds (root via utm-builder key, optional builder user).
  users.users.root.openssh.authorizedKeys.keys = [
    (builtins.readFile ../../keys/utm-builder_ed25519.pub)
    (import ../../config.nix).me.sshKey
  ];
  users.users.builder = {
    isNormalUser = true;
    home = "/home/builder";
    openssh.authorizedKeys.keys = [
      (builtins.readFile ../../keys/builder_ed25519.pub)
    ];
  };

  # Let Nix serve the store to ssh-ng builders.
  nix = {
    package = pkgs.nixVersions.nix_2_28;
    settings.experimental-features = [ "nix-command" "flakes" ];
    settings.trusted-users = [ "root" "builder" ];
    sshServe = {
      enable = true;
      keys = [ (builtins.readFile ../../keys/utm-builder_ed25519.pub) ];
      protocol = "ssh";
    };
  };

  environment.systemPackages = [
    pkgs.git
    pkgs.htop
  ];

  # Keep the image small and focused on being a headless builder.
  documentation.enable = false;
  services.getty.autologinUser = lib.mkForce null;
  system.stateVersion = "25.11";
}
