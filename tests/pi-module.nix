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
  tmuxCfg = (hm.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      ../modules/home/tmux/default.nix
      {
        home.username = "tester";
        home.homeDirectory = "/tmp/tester";
        home.stateVersion = "24.11";
      }
    ];
  }).config;

  disabledCheck = assert' "hub.pi disabled leaves no managed agent files"
    (!builtins.hasAttr ".pi/agent/models.json" disabledCfg.home.file
      && !builtins.hasAttr ".pi/agent/extensions/tmux-attention.ts" disabledCfg.home.file);

  plainCheck = assert' "hub.pi plain mode does not install Pi by default"
    (!builtins.hasAttr ".pi/agent/models.json" plainCfg.home.file
      && !builtins.hasAttr ".local/share/pi-local/agent/models.json" plainCfg.home.file
      && !builtins.elem "pi-local" (packageNames plainCfg)
      && !builtins.elem "pi-coding-agent" (packageNames plainCfg));

  piAttentionCheck =
    let
      path = ".pi/agent/extensions/tmux-attention.ts";
      extension = plainCfg.home.file.${path}.text;
    in
    assert' "hub.pi marks tmux when the agent settles"
      (builtins.hasAttr path plainCfg.home.file
        && lib.hasInfix "agent_settled" extension
        && lib.hasInfix "process.env.TMUX" extension
        && lib.hasInfix "u0007" extension);

  tmuxAttentionCheck =
    let
      configLines = lib.splitString "\n" tmuxCfg.programs.tmux.extraConfig;
      markerLines = builtins.filter (lib.hasInfix "window_bell_flag") configLines;
    in
    assert' "tmux status renders settled-agent bell flags"
      (builtins.length markerLines == 2
        && lib.hasInfix "monitor-bell on" tmuxCfg.programs.tmux.extraConfig);

  localCheck = assert' "hub.pi local mode scopes models and extensions to pi-local"
    (!builtins.hasAttr ".pi/agent/models.json" localCfg.home.file
      && builtins.hasAttr ".local/share/pi-local/agent/models.json" localCfg.home.file
      && builtins.hasAttr ".local/share/pi-local/agent/extensions/tmux-attention.ts" localCfg.home.file
      && builtins.match ".*qwen2\.5-coder:14b.*" localCfg.home.file.".local/share/pi-local/agent/models.json".text != null
      && builtins.elem "pi-local" (packageNames localCfg));

  ds4Check = assert' "hub.pi ds4 mode installs pass-backed pi-ds4 wrapper"
    (builtins.hasAttr ".local/bin/pi-ds4" ds4Cfg.home.file
      && builtins.match ".*DEEPSEEK_API_KEY.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*pass show dev/deepseek-api-key.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*HUB_PASS_LAUNCHERS_BYPASS.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && builtins.match ".*--model deepseek-v4-flash.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && !builtins.elem "secretspec" (packageNames ds4Cfg));
in
pkgs.runCommand "pi-module-tests" { } ''
  cat <<'RESULTS'
  ── Pi Home Manager module ──
  ${disabledCheck}${plainCheck}${piAttentionCheck}${tmuxAttentionCheck}${localCheck}${ds4Check}RESULTS
  echo "All Pi module tests passed."
  echo ok > $out
''
