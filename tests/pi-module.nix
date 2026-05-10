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
  gptCfg = evalCfg {
    enable = true;
    gpt = {
      enable = true;
    };
  };

  disabledCheck = assert' "hub.pi disabled leaves no managed models file"
    (!builtins.hasAttr ".pi/agent/models.json" disabledCfg.home.file);

  localCheck = assert' "hub.pi local mode installs pi-local and models.json"
    (builtins.hasAttr ".pi/agent/models.json" localCfg.home.file
      && builtins.match ".*qwen2\.5-coder:14b.*" localCfg.home.file.".pi/agent/models.json".text != null
      && builtins.elem "pi-local" (packageNames localCfg));

  ds4Check = assert' "hub.pi ds4 mode installs pass-backed pi-ds4 wrapper"
    (builtins.hasAttr ".local/bin/pi-ds4" ds4Cfg.home.file
      && builtins.match ".*DEEPSEEK_API_KEY.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*pass show dev/deepseek-api-key.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*HUB_PASS_LAUNCHERS_BYPASS.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && !builtins.elem "secretspec" (packageNames ds4Cfg));

  gptCheck = assert' "hub.pi gpt mode installs pass-backed pi-gpt wrapper"
    (builtins.hasAttr ".local/bin/pi-gpt" gptCfg.home.file
      && builtins.match ".*OPENAI_API_KEY.*" gptCfg.home.file.".local/bin/pi-gpt".text != null
      && builtins.match ".*pass show veriff/api.openai.com/org-ai.*" gptCfg.home.file.".local/bin/pi-gpt".text != null
      && builtins.match ".*--model openai/gpt-5\\.5.*" gptCfg.home.file.".local/bin/pi-gpt".text != null
      && builtins.match ".*HUB_PASS_LAUNCHERS_BYPASS.*" gptCfg.home.file.".local/bin/pi-gpt".text != null
      && !builtins.elem "secretspec" (packageNames gptCfg));
in
pkgs.runCommand "pi-module-tests" { } ''
  cat <<'RESULTS'
  ── Pi Home Manager module ──
  ${disabledCheck}${localCheck}${ds4Check}${gptCheck}RESULTS
  echo "All Pi module tests passed."
  echo ok > $out
''
