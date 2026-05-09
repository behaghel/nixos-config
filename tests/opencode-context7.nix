{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  evalCfg = attrs:
    (hm.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/pass-launchers.nix
        ../modules/home/opencode/default.nix
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
          hub.opencode = attrs;
        }
      ];
    }).config;

  disabledCfg = evalCfg { };
  enabledCfg = evalCfg {
    context7.enable = true;
  };

  disabledCheck = assert' "context7 wrapper is absent by default"
    (!builtins.hasAttr ".local/bin/opencode" disabledCfg.home.file);

  enabledCheck = assert' "context7 wrapper injects pass-backed CONTEXT7_API_KEY"
    (builtins.hasAttr ".local/bin/opencode" enabledCfg.home.file
      && builtins.match ".*CONTEXT7_API_KEY.*" enabledCfg.home.file.".local/bin/opencode".text != null
      && builtins.match ".*pass show dev/context7-api-key.*" enabledCfg.home.file.".local/bin/opencode".text != null
      && builtins.match ".*HUB_PASS_LAUNCHERS_BYPASS.*" enabledCfg.home.file.".local/bin/opencode".text != null);
in
pkgs.runCommand "opencode-context7" { } ''
  cat <<'RESULTS'
  ── OpenCode Context7 wrapper ──
  ${disabledCheck}${enabledCheck}RESULTS
  echo "All OpenCode Context7 wrapper tests passed."
  echo ok > $out
''
