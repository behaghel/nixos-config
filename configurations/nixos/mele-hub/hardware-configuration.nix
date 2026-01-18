{ modulesPath, ... }:

{
  # Placeholder: regenerate with `nixos-generate-config --root /mnt` on the target
  # hardware before running `nixos-install`.
  imports = [
    (modulesPath + "/installer/scan/not-detected.nix")
  ];

  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  fileSystems."/boot" = {
    device = "/dev/disk/by-label/EFI";
    fsType = "vfat";
    options = [ "fmask=0022" "dmask=0022" ];
  };

  fileSystems."/srv/syncthing" = {
    device = "/dev/disk/by-label/syncthing";
    fsType = "ext4";
  };

  swapDevices = [ { device = "/dev/disk/by-label/swap"; } ];
}
