{ pkgs, lib, inputs }:
let
  me = (import ../config.nix).me;
  evaluate = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../modules/openwrt
      ../configurations/openwrt/beryl-ax
      extra
    ];
  }).config;
  cfg = evaluate { };
  valid = cfg.system.build.bootstrapScript;
  naming = cfg.system.build.namingScript;
  activation = cfg.system.build.activate;
  tunnelFiles = cfg.system.build.exitTunnelFiles;
  tunnelBundle = pkgs.linkFarm "exit-tunnel-fixtures" (lib.mapAttrsToList
    (path: file: {
      name = builtins.baseNameOf path;
      path = pkgs.writeText (builtins.baseNameOf path) file.text;
    })
    tunnelFiles);
  sshConfig = pkgs.writeText "managed-ssh-config"
    (inputs.home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/ssh
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
        }
      ];
    }).config.home.file.".ssh/config".text;
  fails = extra:
    !(builtins.tryEval (builtins.deepSeq
      (evaluate extra).system.build.bootstrapScript.drvPath
      true)).success;
  failsTunnel = extra:
    !(builtins.tryEval (builtins.deepSeq
      (evaluate extra).system.build.exitTunnelFiles
      true)).success;
  allTrusted = evaluate {
    services.exitTunnel.trustedInterfaces = lib.mkForce [ "br-lan" "br-guest" "br-iot" ];
  };
  assertions = [
    (cfg.networking.hostName == "beryl-ax")
    (cfg.ssh.user == "root")
    (cfg.ssh.authorizedKeys == [ me.sshKey ])
    (cfg.services.exitTunnel.trustedInterfaces == [ "br-lan" ])
    (failsTunnel { services.exitTunnel.trustedInterfaces = lib.mkForce [ "eth0" ]; })
    (!(failsTunnel { services.exitTunnel.trustedInterfaces = lib.mkForce [ ]; }))
    (!(lib.hasInfix "jump isolate_clients" allTrusted.system.build.exitTunnelFiles."/etc/nixos-exit/off.nft".text))
    (fails { ssh.authorizedKeys = lib.mkForce [ ]; })
    (fails { ssh.authorizedKeys = lib.mkForce [ "not-a-public-key" ]; })
    (fails { ssh.authorizedKeys = lib.mkForce [ (me.sshKey + "\ninjected") ]; })
  ];
in
assert lib.assertMsg (builtins.all (x: x) assertions)
  "OpenWrt identity, public-key and tunnel trust-boundary invariants";
pkgs.runCommand "openwrt-bootstrap-tests"
{
  nativeBuildInputs = [ pkgs.python3 pkgs.openssh (pkgs.lua5_1.withPackages (ps: [ ps.lua-cjson ])) ];
  TEST_PUBLIC_KEY = me.sshKey;
} ''
  # Check the actual generated artifact, not only the source template.
  sh -n ${valid}
  printf '%s\n' "$TEST_PUBLIC_KEY" > operator.pub
  ssh-keygen -lf operator.pub
  python3 ${./test-openwrt-bootstrap.py} ${valid}
  sh -n ${naming}
  sh -n ${cfg.system.build.activationScript}
  sh -n ${cfg.system.build.sshPolicyScript}
  python3 ${./test-openwrt-naming.py} ${naming} ${lib.getExe activation}
  python3 ${./test-openwrt-ssh-policy.py} ${cfg.system.build.sshPolicyScript}
  sh -n ${cfg.system.build.exitTunnelInstall}
  ${lib.concatStringsSep "\n" (lib.mapAttrsToList (path: file:
    lib.optionalString (file.mode == "0755") "sh -n ${tunnelBundle}/${builtins.baseNameOf path}") tunnelFiles)}
  python3 ${./test-openwrt-exit-tunnel.py} ${tunnelBundle} ${lib.getExe cfg.system.build.tunnel} ${cfg.system.build.exitTunnelInstall}
  ssh -G -F ${sshConfig} beryl-ax > effective
  grep -Fx 'user root' effective
  grep -Fx 'hostname beryl-ax' effective
  grep -Fx 'hostkeyalias beryl-ax' effective
  grep -Fx 'userknownhostsfile ${cfg.ssh.knownHostsFile}' effective
  grep -Fx 'preferredauthentications publickey' effective
  grep -Fx 'batchmode yes' effective
  grep -Fx 'controlmaster false' effective
  # OpenSSH represents ControlPath=none by omitting it from -G output.
  if grep -q '^controlpath ' effective; then
    echo 'connection sharing path unexpectedly enabled' >&2; exit 1
  fi
  grep -Fx 'forwardagent no' effective
  grep -Fx 'hostkeyalgorithms ssh-ed25519' effective
  if ${lib.getExe activation} --check --target 'bad target'; then
    echo 'invalid target was accepted' >&2; exit 1
  fi
  touch $out
''
