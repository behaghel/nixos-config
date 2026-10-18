# Evaluated on the management machine, never on the OpenWrt target.
{ config, lib, pkgs, ... }:
let
  inherit (lib) mkOption types;
  me = (import ../../config.nix).me;
  cfg = config.ssh;
  publicKey = types.strMatching "ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?";
  name = config.networking.hostName;
  identity = pkgs.writeText "operator-ssh.pub" (me.sshKey + "\n");
  sshOptions = lib.concatStringsSep " " (lib.mapAttrsToList
    (key: value: "-o ${lib.escapeShellArg "${key}=${value}"}")
    cfg.clientOptions);
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
      hostKey = mkOption {
        type = publicKey;
        description = "Host public key verified through an existing trusted session.";
      };
      knownHostsFile = mkOption {
        type = types.package;
        readOnly = true;
        description = "Pinned host identity, independent of the current address.";
      };
      clientOptions = mkOption {
        type = types.attrsOf types.str;
        readOnly = true;
        description = "Shared pinned, fresh, public-key-only SSH client policy.";
      };
      authorizedKeys = mkOption {
        type = types.listOf publicKey;
        default = [ me.sshKey ];
        description = "Public keys to add, preserving existing authorizations.";
      };
    };
    system.build.namingScript = mkOption {
      type = types.package;
      readOnly = true;
      description = "Native idempotent hostname and Tailnet naming configuration.";
    };
    system.build.sshPolicyScript = mkOption {
      type = types.package;
      readOnly = true;
      description = "Native key-only SSH policy, preserving web-admin credentials.";
    };
    system.build.activationScript = mkOption {
      type = types.package;
      readOnly = true;
      description = "Native naming and SSH policy, applied only after key authentication.";
    };
    system.build.activate = mkOption {
      type = types.package;
      readOnly = true;
      description = "SSH activation tool with --check and initial --target override.";
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

  config.ssh = {
    knownHostsFile = pkgs.writeText "${name}-known-hosts" "${name} ${cfg.hostKey}\n";
    clientOptions = {
      HostKeyAlias = name;
      UserKnownHostsFile = "${cfg.knownHostsFile}";
      GlobalKnownHostsFile = "/dev/null";
      StrictHostKeyChecking = "yes";
      HostKeyAlgorithms = "ssh-ed25519";
      IdentityFile = "${identity}";
      IdentitiesOnly = "yes";
      PreferredAuthentications = "publickey";
      BatchMode = "yes";
      ControlMaster = "no";
      ControlPath = "none";
      ForwardAgent = "no";
      ClearAllForwardings = "yes";
      ConnectTimeout = "10";
    };
  };
  config.system.build.namingScript = pkgs.writeText "${name}-naming.sh" ''
    #!/bin/sh
    desired_name=${lib.escapeShellArg name}
    ${builtins.readFile ./naming.sh}
  '';
  config.system.build.sshPolicyScript = pkgs.writeText "${name}-ssh-policy.sh" ''
    #!/bin/sh
    operator_key=${lib.escapeShellArg me.sshKey}
    ${builtins.readFile ./ssh-policy.sh}
  '';
  config.system.build.activationScript = pkgs.writeText "${name}-activation.sh" ''
    #!/bin/sh
    set -eu
    desired_name=${lib.escapeShellArg name}
    operator_key=${lib.escapeShellArg me.sshKey}
    (
      ${builtins.readFile ./naming.sh}
    )
    (
      ${builtins.readFile ./ssh-policy.sh}
    )
  '';
  config.system.build.activate = pkgs.writeShellApplication {
    name = "${name}-activate";
    runtimeInputs = [ pkgs.openssh ];
    text = ''
      target=${lib.escapeShellArg name}
      mode=apply
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --check) mode=check; shift ;;
          --apply) mode=apply; shift ;;
          --target)
            [ "$#" -ge 2 ] || { echo '--target requires an address' >&2; exit 2; }
            target=$2; shift 2 ;;
          *) echo 'usage: ${name}:activate [--check|--apply] [--target ADDRESS]' >&2; exit 2 ;;
        esac
      done
      case "$target" in
        ""|-*|*[!a-zA-Z0-9.:-]*) echo 'invalid target address' >&2; exit 2 ;;
      esac
      run_remote() {
        ssh -F /dev/null -l ${lib.escapeShellArg cfg.user} ${sshOptions} \
          "$target" "sh -s -- $1" < ${config.system.build.activationScript}
      }
      run_remote "$mode"
      if [ "$mode" = apply ]; then
        echo 'Verifying with a second fresh SSH authentication; touch your YubiKey.' >&2
        if ! run_remote check; then
          echo 'Fresh-key verification failed; keep the recovery session open.' >&2
          exit 1
        fi
      fi
    '';
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
