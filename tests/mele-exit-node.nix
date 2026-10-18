{ pkgs, lib, inputs }:
let
  cfg = inputs.self.nixosConfigurations.mele-hub.config;
  service = cfg.systemd.services.tailscaled-set;
  checks = [
    (cfg.networking.hostName == "mele-hub")
    cfg.services.tailscale.enable
    (cfg.services.tailscale.useRoutingFeatures == "server")
    (cfg.boot.kernel.sysctl."net.ipv4.ip_forward" == 1)
    cfg.boot.kernel.sysctl."net.ipv4.conf.all.forwarding"
    cfg.boot.kernel.sysctl."net.ipv6.conf.all.forwarding"
    (cfg.services.tailscale.extraSetFlags == [
      "--advertise-exit-node"
      "--netfilter-mode=on"
    ])
    (lib.hasInfix "--advertise-exit-node" service.script)
    (lib.hasInfix "--netfilter-mode=on" service.script)
    (builtins.elem "tailscaled.service" service.after)
    (builtins.elem "multi-user.target" service.wantedBy)
    (cfg.services.tailscale.authKeyFile == null)
    (cfg.services.tailscale.extraUpFlags == [ ])
    (!lib.hasInfix "--reset" service.script)
    cfg.services.tailscale.openFirewall
    (builtins.elem cfg.services.tailscale.port cfg.networking.firewall.allowedUDPPorts)
    (!cfg.networking.nat.enable)
    (builtins.elem "tailscale0" cfg.networking.firewall.trustedInterfaces)
    cfg.networking.networkmanager.enable
    cfg.networking.enableIPv6
  ];
in
assert lib.assertMsg (builtins.all (value: value) checks)
  "MeLE exit-node forwarding, persistent advertisement, and native firewall ownership";
pkgs.runCommand "mele-exit-node-tests" { } ''
  echo 'MeLE exit-node module checks passed; live routing requires activation.'
  touch $out
''
