{ pkgs, lib, ... }:
{
  programs.gpg = {
    enable = true;
    settings = {
      # Your gpg.conf settings here if needed
    };
  };
  services.gpg-agent = {
    enable = true;
    enableSshSupport = true;
    grabKeyboardAndMouse = true;
    enableScDaemon = true;
    defaultCacheTtl = 900;
    defaultCacheTtlSsh = 900;
    maxCacheTtl = 3600;
    maxCacheTtlSsh = 3600;
    pinentry.package = if pkgs.stdenv.isDarwin then pkgs.pinentry_mac else pkgs.pinentry-gtk2;
    extraConfig = lib.mkAfter ''
      enable-ssh-support
      allow-loopback-pinentry
      use-standard-socket
    '';
  };
}
