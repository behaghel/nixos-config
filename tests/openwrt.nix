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
  assertions = [
    (cfg.networking.hostName == "beryl-ax")
    (cfg.ssh.user == "root")
    (cfg.ssh.authorizedKeys == [ me.sshKey ])
    (fails { ssh.authorizedKeys = lib.mkForce [ ]; })
    (fails { ssh.authorizedKeys = lib.mkForce [ "not-a-public-key" ]; })
    (fails { ssh.authorizedKeys = lib.mkForce [ (me.sshKey + "\ninjected") ]; })
  ];
in
assert lib.assertMsg (builtins.all (x: x) assertions)
  "OpenWrt identity and public-key module invariants";
pkgs.runCommand "openwrt-bootstrap-tests"
{
  nativeBuildInputs = [ pkgs.python3 pkgs.openssh ];
  TEST_PUBLIC_KEY = me.sshKey;
} ''
  # Check the actual generated artifact, not only the source template.
  sh -n ${valid}
  printf '%s\n' "$TEST_PUBLIC_KEY" > operator.pub
  ssh-keygen -lf operator.pub
  python3 ${./test-openwrt-bootstrap.py} ${valid}
  sh -n ${naming}
  python3 ${./test-openwrt-naming.py} ${naming} ${lib.getExe activation}
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
