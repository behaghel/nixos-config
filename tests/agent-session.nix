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
  cfg = evaluated.config;
in
assert builtins.all (item: item.assertion) cfg.assertions;
pkgs.runCommand "agent-session-tests"
{
  nativeBuildInputs = cfg.packages ++ [ pkgs.bun pkgs.nodejs_24 pkgs.git pkgs.bash pkgs.zsh pkgs.fish pkgs.nix pkgs.python3 ];
  inherit (cfg.env) AGENT_SESSION_CONFIG AGENT_SESSION_COMPLETION_ROOT AGENT_SESSION_SHELL_ROOT;
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
    bun test ./tests/agent-session.test.ts ./tests/agent-session-templates.test.ts --timeout 30000
    touch "$out"
  ''
