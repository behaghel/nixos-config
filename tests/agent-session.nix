{ pkgs, lib, ... }:
let
  evaluated = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../modules/flake/agent-session/devenv.nix
      {
        options = {
          packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
          env = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          assertions = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
          enterShell = lib.mkOption { type = lib.types.lines; default = ""; };
        };
        config.agentSession.enable = true;
      }
    ];
  };
  hookConfig = pkgs.writeText "agent-session-test-hook-config.json" "{}";
  withHooks = evaluated.extendModules {
    modules = [{
      options.git-hooks = {
        enable = lib.mkOption { type = lib.types.bool; default = true; };
        configFile = lib.mkOption { type = lib.types.package; default = hookConfig; };
      };
    }];
  };
  cfg = withHooks.config;
in
assert builtins.all (item: item.assertion) cfg.assertions;
pkgs.runCommand "agent-session-tests"
{
  nativeBuildInputs = cfg.packages ++ [ pkgs.bun pkgs.nodejs_24 pkgs.git pkgs.bash pkgs.zsh pkgs.fish pkgs.nix pkgs.python3 pkgs.lsof ];
  inherit (cfg.env) AGENT_SESSION_CONFIG AGENT_SESSION_COMPLETION_ROOT AGENT_SESSION_SHELL_ROOT;
  GENERATED_HOOK_TEST_TARGET = hookConfig;
  NO_HOOKS_CONFIG = evaluated.config.env.AGENT_SESSION_CONFIG;
  DISABLED_HOOKS_CONFIG = (withHooks.extendModules {
    modules = [{ git-hooks.enable = false; }];
  }).config.env.AGENT_SESSION_CONFIG;
  RETAIN_DEFAULTS_CONFIG = (withHooks.extendModules {
    modules = [{ agentSession = { disposablePaths = [ ]; recognizeGeneratedHookConfig = false; }; }];
  }).config.env.AGENT_SESSION_CONFIG;
  ARTIFACT_POLICY_CONFIG = (withHooks.extendModules {
    modules = [{ agentSession.disposablePaths = [ ".cache" ]; }];
  }).config.env.AGENT_SESSION_CONFIG;
}
  ''
    export HOME=$(mktemp -d)
    export XDG_CONFIG_HOME="$HOME/.config"
    export GIT_CONFIG_NOSYSTEM=1
    mkdir -p modules/flake/agent-session tests
    cp ${../modules/flake/agent-session}/* modules/flake/agent-session/
    cp ${./agent-session.test.ts} tests/agent-session.test.ts
    cp ${./agent-session-templates.test.ts} tests/agent-session-templates.test.ts
    cp -R ${../templates} templates
    cp ${../devenv.nix} devenv.nix
    cp ${../AGENTS.md} AGENTS.md
    cp ${../.gitignore} .gitignore
    node --input-type=module - <<'JS'
    import { readFileSync } from "node:fs";
    for (const [variable, expected, hook] of [
      ["AGENT_SESSION_CONFIG", [".devenv"], true],
      ["ARTIFACT_POLICY_CONFIG", [".cache"], true],
      ["RETAIN_DEFAULTS_CONFIG", [], false],
      ["NO_HOOKS_CONFIG", [".devenv"], false],
      ["DISABLED_HOOKS_CONFIG", [".devenv"], false]
    ]) {
      const config = JSON.parse(readFileSync(process.env[variable], "utf8"));
      const expectedLinks = hook ? { ".pre-commit-config.yaml": process.env.GENERATED_HOOK_TEST_TARGET } : {};
      if (JSON.stringify(config.disposable_paths) !== JSON.stringify(expected) ||
          JSON.stringify(config.generated_links) !== JSON.stringify(expectedLinks)) throw new Error("Artifact defaults module wiring failed: " + variable);
    }
    JS
    bun test ./tests/agent-session.test.ts ./tests/agent-session-templates.test.ts --timeout 30000
    touch "$out"
  ''
