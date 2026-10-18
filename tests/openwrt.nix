{ pkgs, lib }:
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
  touch $out
''
