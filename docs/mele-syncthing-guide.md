# Configure NixOS for Mele Quieter 4C

Since you prefer the declarative approach with Nix, here is a breakdown of the key configuration recommendations, focusing on hardware enablement, low power, and setting it up as your Syncthing introducer.

## 💻 NixOS Configuration for MeLE Quieter 4C (Intel N150)
1. Initial Hardware Configuration (hardware-configuration.nix)

When you run nixos-generate-config --root /mnt, it will create a base hardware-configuration.nix. You will likely need these additions for full feature support, as the N150 is a newer Alder Lake-N generation CPU:
Setting	Nix Option	Purpose
Microcode	hardware.cpu.intel.updateMicrocode = true;	Crucial. Ensures the CPU is stable and efficient, particularly important for new chipsets like the N150.
Intel Graphics	services.xserver.videoDrivers = [ "modesetting" "intel" ]; (If you need a GUI/Desktop)	Enables the Integrated Intel UHD Graphics (iGPU) and necessary drivers. If running headless (recommended), you can often skip this.
Networking	networking.networkmanager.enable = true; (For Wi-Fi/general network control)	Easiest way to manage the Gigabit Ethernet and the integrated Wi-Fi 5 (802.11ac) adapter.
Filesystem	boot.initrd.luks.enable = true; (Optional)	If you decide to use disk encryption for the M.2 NVMe SSD, ensure this is set.
2. Core Hub Services & Low Power Settings

Your configuration (configuration.nix) should focus on stability and minimal resource use.

A. NixOS Service Setup

We need to enable the services you require (SSH and Syncthing).
Nix

{ config, pkgs, ... }:
{
  # 1. SSH Server (Essential for Headless Management)
  services.openssh.enable = true;
  # Allow root login only with keys (more secure)
  services.openssh.permitRootLogin = "prohibit-password";

  # 2. Syncthing Setup (The Core Function)
  services.syncthing = {
    enable = true;
    user = "hubert"; # Ensure this matches your NixOS user
    group = "users";

    # Run Syncthing as the dedicated Introducer Hub
    settings = {
      options = {
        # Optional: Set the hub to connect to known relays for devices outside your LAN.
        # globalAnnounceServer = "default";
        # Set this to true to make this machine the network Introducer for your devices.
        isIntroducer = true;
      };
    };

    # Configure Firewall to allow Syncthing traffic
    openFirewall = true; # Opens port 22000/TCP/UDP for sync and 21027/UDP for discovery

    # Access the GUI securely only via SSH Tunnel
    # The default is 127.0.0.1:8384. Do NOT expose this to 0.0.0.0.
  };

  # 3. Time Sync
  services.timesyncd.enable = true;

  # 4. Low-Power / Fanless Tweaks
  # TLP (Linux Advanced Power Management) is great for laptop-like CPUs
  services.tlp.enable = true;

  # Ensure the disk is idle-friendly for 24/7 use
  # (Assuming your drive is reliable NVMe/SSD, which the 4C ships with)
  # services.hd-idle.enable = true; # Typically only needed for HDDs
}

B. The syncthing.nix Folder Configuration (Optional but Recommended)

For advanced Nix users, you can also manage the folder and peer list declaratively, though it requires knowing the Device IDs of your other six devices beforehand.
Nix

# Example of defining a peer and folder directly in Nix
# The Hub doesn't need to define the folder, but it defines the peer
 services.syncthing.settings = {
  devices = {
    # Replace the ID with your phone's actual ID
    "YOUR_PHONE_DEVICE_ID" = {
      name = "Hubert-Android-Phone";
      # The introducer will tell your phone about all other peers
      # Introducer setting should be true only on the Hub itself!
    };
    # ... add all 6 devices here
  };
};

## 🚀 Host config: `mele-hub`

This repo now ships a NixOS configuration for the MeLE hub at `configurations/nixos/mele-hub/`. Highlights:
- Headless, no desktop services.
- SSH is key-only (root disabled), fail2ban enabled, firewall only opens SSH + Syncthing ports.
- Syncthing runs as a dedicated `syncthing` user with data under `/srv/syncthing`; the `hub` admin user is in the `syncthing` group.
- Emacs + CLI tooling come from the shared Home Manager modules for the `hub` user (no GUI extras).
- Microcode, firmware blobs, TLP, and basic kernel sysctl hardening are enabled.

The hardware file is a placeholder—regenerate it on the target with `nixos-generate-config --root /mnt` and replace `configurations/nixos/mele-hub/hardware-configuration.nix`.

## 💿 Build a bootable ISO for `mele-hub`

Run from the repo root (on any Nix-enabled machine):

```bash
nix run github:nix-community/nixos-generators -- --flake .#mele-hub --format iso
```

The resulting image is linked at `result/iso/`. Flash it to a USB drive (adjust `sdX`):

```bash
sudo dd if=$(readlink -f result/iso/nixos-*.iso) of=/dev/sdX bs=4M status=progress conv=fsync
```

### Building the ISO from macOS with Rosetta builder
On macOS, the nix-darwin Rosetta builder provides an `x86_64-linux` worker automatically. After activating your darwin config, just run:

```bash
nix build --system x86_64-linux .#nixosConfigurations.mele-hub.config.system.build.isoImage
```

The ISO will be at `result/iso/nixos-*.iso`.

## 🛠️ Bootstrap steps on the MeLE

1) Boot from the USB stick; get network up (ethernet or `nmtui` for Wi-Fi).  
2) Partition the disk (UEFI + ext4 root labelled `nixos` to match the placeholder) and mount under `/mnt`.  
3) Generate hardware config and replace the placeholder in this repo:  
   ```bash
   nixos-generate-config --root /mnt
   cp /mnt/etc/nixos/hardware-configuration.nix configurations/nixos/mele-hub/
   ```  
4) From the live session, clone/pull this repo, then install:  
   ```bash
   sudo nixos-install --flake .#mele-hub
   ```  
5) Reboot, log in as `hub` with your SSH key. Optionally set a password for sudo (`passwd hub`) and add your Syncthing device IDs in `/var/lib/syncthing/config.xml` or via the SSH-tunnelled GUI (`ssh -L8384:localhost:8384 hub@mele-hub` → http://localhost:8384).
