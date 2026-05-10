{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;
  fileAttr = "opencode/oh-my-openagent.json";
  mixedPath = ../modules/home/opencode/oh-my-openagent.json;
  openaiOnlyPath = ../modules/home/opencode/oh-my-openagent-openai-only.json;
  geminiOnlyPath = ../modules/home/opencode/oh-my-openagent-gemini-only.json;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  evalMode = mode:
    (hm.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/pass-launchers.nix
        ../modules/home/opencode/default.nix
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
          hub.opencode.modelConfigMode = mode;
        }
      ];
    }).config;

  nativeCfg = evalMode "native";
  mixedCfg = evalMode "sans-claude";
  openaiOnlyCfg = evalMode "openai-only";
  geminiOnlyCfg = evalMode "gemini-only";

  nativeCheck = assert' "native mode omits oh-my-openagent.json"
    (!builtins.hasAttr fileAttr nativeCfg.xdg.configFile);

  mixedCheck = assert' "sans-claude mode keeps current mixed config"
    (builtins.hasAttr fileAttr mixedCfg.xdg.configFile
      && mixedCfg.xdg.configFile.${fileAttr}.source == mixedPath
      && builtins.match ".*google/.*" (builtins.readFile mixedPath) != null);

  openaiOnlyCheck = assert' "openai-only mode uses OpenAI-only config"
    (builtins.hasAttr fileAttr openaiOnlyCfg.xdg.configFile
      && openaiOnlyCfg.xdg.configFile.${fileAttr}.source == openaiOnlyPath
      && builtins.match ".*google/.*" (builtins.readFile openaiOnlyPath) == null
      && builtins.match ".*openai/gpt-5\.5.*" (builtins.readFile openaiOnlyPath) != null);

  geminiOnlyCheck = assert' "gemini-only mode uses Gemini-only config"
    (builtins.hasAttr fileAttr geminiOnlyCfg.xdg.configFile
      && geminiOnlyCfg.xdg.configFile.${fileAttr}.source == geminiOnlyPath
      && builtins.match ".*google/.*" (builtins.readFile geminiOnlyPath) != null
      && builtins.match ".*openai/.*" (builtins.readFile geminiOnlyPath) == null);
in
pkgs.runCommand "opencode-model-config-modes" { } ''
  cat <<'RESULTS'
  ── OpenCode model config modes ──
  ${nativeCheck}${mixedCheck}${openaiOnlyCheck}${geminiOnlyCheck}RESULTS
  echo "All OpenCode model config mode tests passed."
  echo ok > $out
''
