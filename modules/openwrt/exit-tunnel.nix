{ config, pkgs, lib, ... }:
let
  cfg = config.services.exitTunnel;
  marker = "# Managed by nixos-config OpenWrt exit-node module.";
  data = text: { inherit text; mode = "0644"; };
  executable = text: { inherit text; mode = "0755"; };
  localInterfaces = lib.concatStringsSep ", " (map builtins.toJSON cfg.localInterfaces);
  untrustedInterfaces = lib.subtractLists cfg.trustedInterfaces cfg.localInterfaces;
  untrustedNames = lib.concatStringsSep ", " (map builtins.toJSON untrustedInterfaces);
  # Independent of fw3; accepting here still leaves native policy in force.
  nftProfile = protected: ready: data ''
    ${marker}
    table inet nixos_exit_guard {
      chain isolate_clients {
        # Return, not accept: replies still traverse mode and native policy.
        ct direction reply return
        ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } counter reject
        ip6 daddr { fc00::/7, fe80::/10 } counter reject
      }
      chain forward {
        type filter hook forward priority -10; policy accept;
        ${lib.optionalString (untrustedInterfaces != [ ]) ''
          iifname { ${untrustedNames} } jump isolate_clients
        ''}
        ${lib.optionalString protected ''
          ip daddr 100.100.100.100 udp dport 53 counter reject
          ip daddr 100.100.100.100 tcp dport 53 counter reject
          iifname { ${localInterfaces} } oifname { ${localInterfaces} } accept
          meta nfproto ipv6 counter reject
          ${lib.optionalString ready ''
            iifname "tailscale0" accept
            iifname { ${localInterfaces} } oifname "tailscale0" accept
          ''}
          counter reject
        ''}
      }
      chain output {
        type filter hook output priority -10; policy accept;
        ${lib.optionalString protected ''
          oifname "lo" accept
          oifname { ${localInterfaces} } accept
          ${lib.optionalString ready ''
            meta skuid 453 ip daddr ${cfg.dnsAddress} oifname "tailscale0" udp dport 53 counter accept
            meta skuid 453 ip daddr ${cfg.dnsAddress} oifname "tailscale0" tcp dport 53 counter accept
            meta skuid 453 ip daddr 100.100.100.100 oifname "tailscale0" udp dport 53 counter accept
            meta skuid 453 ip daddr 100.100.100.100 oifname "tailscale0" tcp dport 53 counter accept
          ''}
          meta skuid 453 udp dport 53 counter reject
          meta skuid 453 tcp dport 53 counter reject
          oifname "tailscale0" accept
          meta mark & 0xff0000 == 0x80000 accept
          udp dport 53 accept
          tcp dport 53 accept
          udp dport 123 accept
          ip protocol icmp accept
          meta l4proto ipv6-icmp accept
          udp sport 68 udp dport 67 accept
          udp sport 546 udp dport 547 accept
          counter reject
        ''}
      }
    }
  '';
  files = assert lib.assertMsg
    (builtins.all (name: builtins.elem name cfg.localInterfaces) cfg.trustedInterfaces)
    "Trusted exit-tunnel interfaces must be qualified local interfaces"; {
    "/usr/sbin/nixos-exit-node" = executable ''
      #!/bin/sh
      ${marker}
      exit_ip=${lib.escapeShellArg cfg.exitNode.address}
      exit_id=${lib.escapeShellArg cfg.exitNode.id}
      tailnet_suffix=${lib.escapeShellArg cfg.tailnetSuffix}
      dns_address=${lib.escapeShellArg cfg.dnsAddress}
      on_hash=${builtins.hashString "sha256" files."/etc/nixos-exit/on.nft".text}
      armed_hash=${builtins.hashString "sha256" files."/etc/nixos-exit/armed.nft".text}
      off_hash=${builtins.hashString "sha256" files."/etc/nixos-exit/off.nft".text}
      downstream_zones=${lib.escapeShellArg (lib.concatStringsSep " " cfg.downstreamZones)}
      ${builtins.readFile ./exit-tunnel-native.sh}
      ${builtins.readFile ./exit-tunnel.sh}
    '';
    "/etc/nixos-exit/on.nft" = nftProfile true true;
    "/etc/nixos-exit/armed.nft" = nftProfile true false;
    "/etc/nixos-exit/off.nft" = nftProfile false false;
    "/etc/nixos-exit/native-dns.lua" = data (builtins.readFile ./exit-tunnel-dns.lua);
    "/etc/init.d/nixos-exit" = executable ''
      #!/bin/sh /etc/rc.common
      ${marker}
      USE_PROCD=1
      START=18
      STOP=90
      start_service() {
        /usr/sbin/nixos-exit-node guard || return 1
        procd_open_instance
        procd_set_param command /usr/sbin/nixos-exit-node watch
        procd_set_param respawn
        procd_set_param stderr 1
        procd_close_instance
      }
      # Stopping reconciliation does not remove protection from the kernel.
    '';
  };
  writeFiles = lib.concatStringsSep "\n" (lib.mapAttrsToList
    (path: file:
      let delimiter = "NIX_EXIT_${builtins.hashString "sha256" file.text}";
      in ''
        write_owned ${lib.escapeShellArg path} ${file.mode} <<'${delimiter}'
        ${file.text}${delimiter}
      '')
    files);
  sshOptions = lib.concatStringsSep " " (lib.mapAttrsToList
    (key: value: "-o ${lib.escapeShellArg "${key}=${value}"}")
    config.ssh.clientOptions);
in
{
  options.services.exitTunnel = {
    enable = lib.mkEnableOption "protected manual exit mode on qualified GL.iNet 4.11 fw3 firmware";
    exitNode.address = lib.mkOption { type = lib.types.strMatching "100\\.[0-9]+\\.[0-9]+\\.[0-9]+"; };
    exitNode.id = lib.mkOption { type = lib.types.strMatching "[a-zA-Z0-9]+"; };
    localInterfaces = lib.mkOption {
      type = lib.types.nonEmptyListOf (lib.types.strMatching "[a-zA-Z0-9_.:-]+");
      default = [ "br-lan" "br-guest" "br-iot" ];
      description = "Qualified local links; add a native VLAN's link and downstream zone before using it.";
    };
    trustedInterfaces = lib.mkOption {
      type = lib.types.listOf (lib.types.strMatching "[a-zA-Z0-9_.:-]+");
      default = [ "br-lan" ];
      description = "Qualified local links allowed to initiate routed private/Tailnet traffic in either mode.";
    };
    downstreamZones = lib.mkOption {
      type = lib.types.addCheck
        (lib.types.listOf (lib.types.strMatching "[a-zA-Z0-9_]+"))
        (zones: zones != [ ] && !(builtins.elem "wan" zones) && !(builtins.elem "tailscale0" zones));
      default = [ "lan" "guest" "iot" ];
      description = "Native client zones allowed outbound to Tailscale; absent zones are skipped.";
    };
    tailnetSuffix = lib.mkOption {
      type = lib.types.strMatching "[a-z0-9-]+\\.ts\\.net";
      description = "Authoritative MagicDNS suffix; Quad100 must not proxy public names.";
    };
    dnsAddress = lib.mkOption {
      type = lib.types.strMatching "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+";
      default = "9.9.9.9";
      description = "Native client resolver in both modes; only its egress path changes.";
    };
  };
  options.system.build = {
    exitTunnelFiles = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options.text = lib.mkOption { type = lib.types.lines; };
        options.mode = lib.mkOption { type = lib.types.enum [ "0644" "0755" ]; };
      });
      readOnly = true;
    };
    exitTunnelInstallText = lib.mkOption { type = lib.types.lines; readOnly = true; };
    exitTunnelInstall = lib.mkOption { type = lib.types.package; readOnly = true; };
    tunnel = lib.mkOption { type = lib.types.package; readOnly = true; };
  };
  config = lib.mkIf cfg.enable {
    system.build.exitTunnelFiles = files;
    system.build.exitTunnelInstallText = ''
      #!/bin/sh
      exit_ip=${lib.escapeShellArg cfg.exitNode.address}
      exit_id=${lib.escapeShellArg cfg.exitNode.id}
      dns_address=${lib.escapeShellArg cfg.dnsAddress}
      tailnet_suffix=${lib.escapeShellArg cfg.tailnetSuffix}
      downstream_zones=${lib.escapeShellArg (lib.concatStringsSep " " cfg.downstreamZones)}
      ${builtins.readFile ./exit-tunnel-native.sh}
      ${builtins.readFile ./exit-tunnel-install.sh}
      ${writeFiles}
      ${builtins.readFile ./exit-tunnel-install-finish.sh}
    '';
    system.build.exitTunnelInstall = pkgs.writeText "exit-tunnel-install.sh" config.system.build.exitTunnelInstallText;
    system.build.tunnel = pkgs.writeShellApplication {
      name = "${config.networking.hostName}-tunnel";
      runtimeInputs = [ pkgs.openssh ];
      text = ''
        case "''${1:-check}" in on|off|check) operation=''${1:-check} ;; *) echo 'use on, off, or check' >&2; exit 2 ;; esac
        [ "$#" -le 1 ] || exit 2
        exec ssh -F /dev/null -l ${lib.escapeShellArg config.ssh.user} ${sshOptions} \
          ${lib.escapeShellArg config.networking.hostName} "/usr/sbin/nixos-exit-node $operation"
      '';
    };
  };
}
