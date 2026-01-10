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

  swapDevices = [ ];
}
