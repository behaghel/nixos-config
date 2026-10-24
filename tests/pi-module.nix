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
  selfManagedCfg = evalCfg {
    enable = true;
    npm.enable = false;
  };
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
      && !builtins.hasAttr ".pi/agent/extensions/tmux-attention.ts" disabledCfg.home.file
      && !builtins.hasAttr ".pi/agent/extensions/relative-paths" disabledCfg.home.file);

  plainCheck = assert' "hub.pi plain mode does not install Pi by default"
    (!builtins.hasAttr ".pi/agent/models.json" plainCfg.home.file
      && !builtins.hasAttr ".local/share/pi-local/agent/models.json" plainCfg.home.file
      && !builtins.elem "pi-local" (packageNames plainCfg)
      && !builtins.elem "pi-coding-agent" (packageNames plainCfg));

  selfManagedCheck = assert' "self-managed Pi retains integration without activation-time npm"
    (!builtins.hasAttr "installPiWithNpm" selfManagedCfg.home.activation
      && builtins.hasAttr ".pi/agent/extensions/tmux-attention.ts" selfManagedCfg.home.file
      && !builtins.elem "nodejs" (packageNames selfManagedCfg));

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

  relativePathsCheck =
    let
      files = [ "index.ts" "core.ts" ];
      installed = cfg: prefix:
        let source = cfg.home.file."${prefix}/relative-paths".source;
        in builtins.attrNames (builtins.readDir source) == [ "core.ts" "index.ts" ]
          && builtins.all
          (file: builtins.readFile (source + "/${file}")
            == builtins.readFile (../modules/home/pi/relative-paths + "/${file}"))
          files;
    in
    assert' "Pi and pi-local install the same relative-file-link extension"
      (installed plainCfg ".pi/agent/extensions"
        && installed selfManagedCfg ".pi/agent/extensions"
        && installed localCfg ".local/share/pi-local/agent/extensions"
        && lib.hasInfix "xterm-ghostty:hyperlinks" tmuxCfg.programs.tmux.extraConfig);

  tmuxAttentionCheck =
    let
      configLines = lib.splitString "\n" tmuxCfg.programs.tmux.extraConfig;
      markerLines = builtins.filter (lib.hasInfix "window_bell_flag") configLines;
    in
    assert' "tmux renders settled-agent alerts as a cyan inactive pill"
      (builtins.length markerLines == 1
        && lib.hasInfix "window-status-bell-style noreverse" tmuxCfg.programs.tmux.extraConfig
        && lib.hasInfix "#[fg=colour37]" (builtins.head markerLines)
        && lib.hasInfix "fg=colour234#,bg=colour37#,bold" (builtins.head markerLines)
        && lib.hasInfix "● #W" (builtins.head markerLines)
        && !lib.hasInfix " !" tmuxCfg.programs.tmux.extraConfig
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
      && builtins.match ".*--model deepseek/deepseek-flash.*" ds4Cfg.home.file.".local/bin/pi-ds4".text != null
      && !builtins.elem "secretspec" (packageNames ds4Cfg));
  ds4Wrapper = pkgs.writeText "pi-ds4" ds4Cfg.home.file.".local/bin/pi-ds4".text;
  stubPi = pkgs.writeShellScriptBin "pi" ''
    printf '%s\n' "$@"
    printf 'key=%s\n' "''${DEEPSEEK_API_KEY:-unset}"
    exit "''${STUB_EXIT:-0}"
  '';
in
pkgs.runCommand "pi-module-tests" { } ''
  cat <<'RESULTS'
  ── Pi Home Manager module ──
  ${disabledCheck}${plainCheck}${selfManagedCheck}${piAttentionCheck}${relativePathsCheck}${tmuxAttentionCheck}${localCheck}${ds4Check}RESULTS
  # Exercise the generated launcher without pass, network access, or real credentials.
  sh=${pkgs.dash}/bin/dash
  "$sh" -n ${ds4Wrapper}
  export PATH=${stubPi}/bin
  actual=$(DEEPSEEK_API_KEY=test-key "$sh" ${ds4Wrapper} "two words" --offline)
  expected=$(printf '%s\n' --model deepseek/deepseek-flash "two words" --offline key=test-key)
  test "$actual" = "$expected"

  actual=$(HUB_PASS_LAUNCHERS_BYPASS=1 DEEPSEEK_API_KEY= "$sh" ${ds4Wrapper} --help)
  expected=$(printf '%s\n' --model deepseek/deepseek-flash --help key=unset)
  test "$actual" = "$expected"

  status=0
  HUB_PASS_LAUNCHERS_BYPASS=1 STUB_EXIT=17 "$sh" ${ds4Wrapper} >/dev/null || status=$?
  test "$status" = 17

  status=0
  PATH= HUB_PASS_LAUNCHERS_BYPASS=1 "$sh" ${ds4Wrapper} >missing.log 2>&1 || status=$?
  test "$status" = 1
  ${pkgs.gnugrep}/bin/grep -F "could not locate the real pi binary" missing.log
  echo "All Pi module tests passed."
  echo ok > $out
''
