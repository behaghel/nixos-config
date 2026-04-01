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
    pkgs.texlive.combined.scheme-small
    pkgs.qemu
  ];

  hub.darwin.apps = {
    enable = true;
    taps = [
      "sst/tap"
    ];
    brews = [
      "sst/tap/opencode"
    ];
    casks = [
      "anki"
      "zotero"
      "1password"
      "codex"
      "ghostty"
      "iterm2"
      "notunes"
      "vlc"
      "hammerspoon"
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
    # Key is pre-installed at /etc/nix/utm-builder_ed25519 (git-ignored); leave
    # privateKeySource unset so evaluation does not try to copy it into the store.
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
  home-manager.backupFileExtension = "backup";
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;
}
