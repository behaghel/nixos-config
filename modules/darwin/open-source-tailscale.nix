{ config, lib, pkgs, ... }:

let
  cfg = config.hub.darwin.openSourceTailscale;
  brewPrefix = if pkgs.stdenv.hostPlatform.isAarch64 then "/opt/homebrew" else "/usr/local";
in
{
  options.hub.darwin.openSourceTailscale.enable = lib.mkEnableOption ''
    open-source Tailscale CLI/daemon from Homebrew
  '';

  config = lib.mkIf cfg.enable {
    homebrew.enable = lib.mkDefault true;
    homebrew.brews = lib.mkBefore [ "tailscale" ];

    launchd.daemons."com.tailscale.tailscaled" = {
      serviceConfig = {
        Label = "com.tailscale.tailscaled";
        ProgramArguments = [ "${brewPrefix}/bin/tailscaled" ];
        RunAtLoad = true;
        KeepAlive = true;
        StandardOutPath = "/var/log/tailscaled.log";
        StandardErrorPath = "/var/log/tailscaled.err.log";
        EnvironmentVariables = {
          PATH = "${brewPrefix}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
        };
      };
    };
  };
}
