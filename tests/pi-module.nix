{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  packageNames = cfg: map lib.getName cfg.home.packages;

  evalCfg = attrs:
    (hm.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/pass-launchers.nix
        ../modules/home/pi/default.nix
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
          hub.pi = attrs;
        }
      ];
    }).config;

  disabledCfg = evalCfg { enable = false; };
  plainCfg = evalCfg { enable = true; };
  localCfg = evalCfg {
    enable = true;
    local.enable = true;
  };
  ds4Cfg = evalCfg {
    enable = true;
    ds4 = {
      enable = true;
    };
  };

  disabledCheck = assert' "hub.pi disabled leaves no managed models file"
    (!builtins.hasAttr ".pi/agent/models.json" disabledCfg.home.file);

  plainCheck = assert' "hub.pi plain mode keeps upstream Pi behavior"
    (!builtins.hasAttr ".pi/agent/models.json" plainCfg.home.file
      && !builtins.hasAttr ".local/share/pi-local/agent/models.json" plainCfg.home.file
      && !builtins.elem "pi-local" (packageNames plainCfg)
      && builtins.elem "pi-coding-agent" (packageNames plainCfg));

  localCheck = assert' "hub.pi local mode scopes models to pi-local"
    (!builtins.hasAttr ".pi/agent/models.json" localCfg.home.file
      && builtins.hasAttr ".local/share/pi-local/agent/models.json" localCfg.home.file
      && builtins.match ".*qwen2\.5-coder:14b.*" localCfg.home.file.".local/share/pi-local/agent/models.json".text != null
      && builtins.elem "pi-local" (packageNames localCfg));

  ds4Check = assert' "hub.pi ds4 mode installs pass-backed pi-ds4 wrapper"
    (builtins.hasAttr ".local/bin/pi-ds4" ds4Cfg.home.file
      && builtins.match ".*DEEPSEEK_API_KEY.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*pass show dev/deepseek-api-key.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*HUB_PASS_LAUNCHERS_BYPASS.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && !builtins.elem "secretspec" (packageNames ds4Cfg));
in
pkgs.runCommand "pi-module-tests" { } ''
  cat <<'RESULTS'
  ── Pi Home Manager module ──
  ${disabledCheck}${plainCheck}${localCheck}${ds4Check}RESULTS
  echo "All Pi module tests passed."
  echo ok > $out
''
