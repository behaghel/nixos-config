{ flake, pkgs, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
    ../../modules/nixos/gui/fonts.nix
    ../../modules/darwin/utm-builder.nix
  ];

  nixpkgs.hostPlatform = "aarch64-darwin";
  nixpkgs.config.allowUnfree = true;
  networking.hostName = "F2400216";

  system.primaryUser = "hubertbehaghel";

  # Users provisioned on this host
  myusers = [ "hubertbehaghel" ];

  environment.systemPackages = [
    pkgs.jdk21_headless
    pkgs.qemu
  ];

  hub.darwin.apps = {
    enable = true;
    casks = [
      "anki"
      "zotero"
      "1password"
      "ghostty"
      "iterm2"
      "notunes"
      "vlc"
      "dropbox"
      "hammerspoon"
      "grishka/grishka/neardrop"
      "firefox"
      "gimp"
      "utm"
    ];
  };

  # No Touch ID override for sudo; fall back to default PAM stack.

  nix.linux-builder.enable = true;

  hub.darwin.utmBuilder = {
    enable = true;
    imagePath = "/var/lib/utm-builder/builder-x86_64-25.11.qcow2";
    port = 2223;
    cpus = 4;
    memoryMB = 4096;
    privateKeySource = ../../keys/utm-builder_ed25519;
    additionalBuilders = [
      "ssh-ng://builder@builder-arm aarch64-linux /etc/nix/builder_ed25519 2 1 kvm,benchmark,big-parallel"
    ];
    sshConfigExtra = ''
Host builder-arm
  Hostname 127.0.0.1
  Port 31022
  IdentityFile /etc/nix/builder_ed25519
  IdentitiesOnly yes
'';
  };

  # Make Home Manager share the system pkgs (avoids rebuilding stdenv/toolchain twice).
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;
}
