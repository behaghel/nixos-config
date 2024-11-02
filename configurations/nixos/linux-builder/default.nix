/* My Linux VM running on macOS

  ## Using Parallels to create a NixOS VM

  - Boot into a NixOS graphical installer
  - Open terminal, and set a root password using `sudo su -` and `passwd root`
  - Authorize yourself to login to the root user using `ssh-copy-id -o PreferredAuthentications=password root@linux-builder`
  - Run nixos-anywhere (see justfile; `j remote-deploy`)
*/
{ flake, modulesPath, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    (modulesPath + "/installer/scan/not-detected.nix")
    self.nixosModules.common
    ../../../modules/nixos/server/harden/basics.nix
    ./parallels-vm.nix
  ];

  # Basics
  system.stateVersion = "23.11";
  boot = {
    loader = {
      systemd-boot.enable = true;
      efi.canTouchEfiVariables = true;
    };
    swraid.mdadmConf = ''
      MAILADDR behaghel@gmail.com
    '';
  };
  # disko.devices = import ../../../modules/nixos/linux/disko/trivial.nix { device = "/dev/sda"; };
  networking = {
    hostName = "linux-builder";
    networkmanager.enable = true;
  };

  # Distributed Builder
  nixpkgs.hostPlatform = "aarch64-linux";
  boot.binfmt.emulatedSystems = [ "x86_64-linux" ]; # For cross-compiling
  services.openssh.enable = true;
  users.users.${flake.config.me.username}.openssh.authorizedKeys.keys = [
    flake.config.me.sshKey
  ];
}
