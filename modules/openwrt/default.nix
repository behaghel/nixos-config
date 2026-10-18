# Evaluated on the management machine, never on the OpenWrt target.
{ config, lib, pkgs, ... }:
let
  inherit (lib) mkOption types;
  me = (import ../../config.nix).me;
  cfg = config.ssh;
  publicKey = types.strMatching "ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?";
in
{
  options = {
    networking.hostName = mkOption {
      type = types.strMatching "[a-z0-9]([a-z0-9-]*[a-z0-9])?";
      description = "Canonical native hostname and Tailscale machine name.";
    };
    ssh = {
      user = mkOption {
        type = types.enum [ "root" ];
        default = "root";
        description = "Native OpenWrt administration account.";
      };
      authorizedKeys = mkOption {
        type = types.listOf publicKey;
        default = [ me.sshKey ];
        description = "Public keys to add, preserving existing authorizations.";
      };
    };
    system.build.bootstrapScript = mkOption {
      type = types.package;
      readOnly = true;
      description = ''
        Public-key-only native bootstrap. Run check or apply from a trusted
        local root session; does not disable passwords or restart services.
      '';
    };
  };

  config.system.build.bootstrapScript =
    assert lib.assertMsg (builtins.elem me.sshKey cfg.authorizedKeys)
      "OpenWrt hosts must authorize config.nix me.sshKey";
    pkgs.writeText "${config.networking.hostName}-bootstrap.sh" ''
      #!/bin/sh
      managed_keys=${lib.escapeShellArg (lib.concatStringsSep "\n" (lib.unique cfg.authorizedKeys))}
      ${builtins.readFile ./bootstrap.sh}
    '';
}
