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
    defaultCacheTtl = 7200;
    defaultCacheTtlSsh = 7200;
    pinentry.package = if pkgs.stdenv.isDarwin then pkgs.pinentry_mac else pkgs.pinentry-gtk2;
    extraConfig = lib.mkAfter ''
      enable-ssh-support
      # Touch-required authentication is handled on the token. Leave commented if you want defaults.
      # use-standard-socket
    '';
  };
}
