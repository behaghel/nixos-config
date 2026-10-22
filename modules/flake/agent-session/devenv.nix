{ config, lib, pkgs, ... }:

let
  cfg = config.agentSession;
  runtimeConfig = pkgs.writeText "agent-session-config.json" (builtins.toJSON {
    version = 1;
    worktree_root = cfg.worktreeRoot;
    agent_command = cfg.agentCommand;
    prepare_command = cfg.prepareCommand;
    local_links = cfg.localLinks;
  });
  agentSessionCommand = pkgs.writeShellApplication {
    name = "agent-session";
    runtimeInputs = [ pkgs.nodejs_24 pkgs.git pkgs.gh ];
    text = ''
      action="''${2-}"
      case "''${1-}" in
        --) action="''${3-}" ;;
        status|doctor|finish|completion|__complete) action= ;;
      esac
      if [ "''${0##*/}" = as ] && [ "$action" = cd ]; then
        printf '%s\n' "as <slug> cd requires shell integration; source \"\$AGENT_SESSION_SHELL_ROOT/init.sh\" in Bash/Zsh or init.fish in Fish." >&2
        exit 64
      fi
      export AGENT_SESSION_CONFIG=${runtimeConfig}
      exec ${lib.getExe pkgs.nodejs_24} ${./.}/cli.ts "$@"
    '';
  };
  aliasPackage = pkgs.runCommand "agent-session-as-alias" { } ''
    mkdir -p "$out/bin"
    ln -s ${agentSessionCommand}/bin/agent-session "$out/bin/as"
  '';
  completionPackage = pkgs.runCommand "agent-session-completions"
    {
      nativeBuildInputs = [ agentSessionCommand ];
    } ''
    mkdir -p \
      "$out/share/bash-completion/completions" \
      "$out/share/zsh/site-functions" \
      "$out/share/fish/vendor_completions.d" \
      "$out/share/fish/vendor_conf.d" \
      "$out/share/agent-session" \
      "$out/nix-support"
    cp ${./shell-integration.sh} "$out/share/agent-session/init.sh"
    cp ${./shell-integration.fish} "$out/share/agent-session/init.fish"
    cp ${./shell-integration.fish} "$out/share/fish/vendor_conf.d/agent-session.fish"
    agent-session completion bash > "$out/share/bash-completion/completions/agent-session"
    ln -s agent-session "$out/share/bash-completion/completions/as"
    agent-session completion zsh > "$out/share/zsh/site-functions/_agent_session"
    agent-session completion fish > "$out/share/fish/vendor_completions.d/agent-session.fish"
    sed 's/-c agent-session /-c as /g' "$out/share/fish/vendor_completions.d/agent-session.fish" > "$out/share/fish/vendor_completions.d/as.fish"
    cat > "$out/nix-support/setup-hook" <<EOF
    addToSearchPath XDG_DATA_DIRS "$out/share"
    # direnv loads this hook after Zsh's compinit; exporting FPATH would replace
    # the running shell's fpath and hide completions installed before entry.
    if test -n "\$BASH_VERSION" && type complete >/dev/null 2>&1; then
      . "$out/share/bash-completion/completions/agent-session"
      . "$out/share/agent-session/init.sh"
    fi
    EOF
  '';
  agentSessionPackage = pkgs.symlinkJoin {
    name = "agent-session-with-completions";
    paths = [ agentSessionCommand aliasPackage completionPackage ];
  };
in
{
  options.agentSession = {
    enable = lib.mkEnableOption "isolated coding-agent worktree sessions";

    worktreeRoot = lib.mkOption {
      type = lib.types.str;
      default = ".worktrees";
      description = "Git-ignored project-local subtree used for managed worktrees.";
    };

    agentCommand = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "pi" ];
      description = "Agent executable and arguments launched inside a managed worktree.";
    };

    prepareCommand = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Optional executable and arguments run once before recording a new session.";
    };

    localLinks = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Ignored project-local paths symlinked into each managed worktree.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion =
          cfg.worktreeRoot != ""
          && cfg.worktreeRoot != "."
          && !(lib.hasPrefix "/" cfg.worktreeRoot)
          && builtins.all (segment: segment != "..") (lib.splitString "/" cfg.worktreeRoot);
        message = "agentSession.worktreeRoot must be a non-traversing relative subtree.";
      }
      {
        assertion = cfg.agentCommand != [ ];
        message = "agentSession.agentCommand must not be empty.";
      }
    ];

    packages = [ agentSessionPackage ];
    # Projects with additional completions can override this colon-separated list.
    # Never export FPATH: direnv would replace the running shell's existing fpath.
    env.DIRENV_ZSH_COMPLETION_DIRS = lib.mkDefault "${completionPackage}/share/zsh/site-functions";
    env.AGENT_SESSION_COMPLETION_ROOT = "${completionPackage}/share";
    env.AGENT_SESSION_CONFIG = runtimeConfig;
    env.AGENT_SESSION_SHELL_ROOT = "${completionPackage}/share/agent-session";
    enterShell = ''
      source ${./shell-integration.sh}
    '';
  };
}
