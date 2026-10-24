# Opt-in editing/testing pilot. Nix, signing and publication stay on the host.
{ pkgs, inputs, ... }:
let
  lib = pkgs.lib;
  sandbox = import inputs.agent-sandbox { inherit pkgs; };
  agentDir = "$HOME/.local/state/pi-sandbox/agent";
  runtimeDir = "$HOME/.local/share/pi-npm";
  cli = "${runtimeDir}/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
  instructions = pkgs.writeText "pi-sandbox-instructions.md" ''
    This is the restricted editing/testing pilot, not a normal host session.
    Use the pre-provisioned tools directly. Do not invoke as, devenv, Nix,
    signing or publication commands here. Preserve signing configuration.
    Edit and test in this worktree; leave commits and pushes to the Operator
    outside the sandbox. Unrelated home files and other projects are denied.
    MCP, extensions, skills and inherited context are disabled for this pilot.
    Internet access is unrestricted; do not send private project content to
    external services except the explicitly chosen model provider.
  '';
  tools = sandbox.commonTools ++ [ pkgs.python3 pkgs.nodejs_24 ];
  # Shared by the real Pi launch and the executable boundary test.
  confine = { pkg, binName, outName }: sandbox.mkSandbox {
    inherit pkg binName outName;
    allowedPackages = tools;
    allowNix = false;
    allowUnixSockets = false;
    rwDirs = [ agentDir ];
    roDirs = [ runtimeDir ];
    env = {
      PI_CODING_AGENT_DIR = agentDir;
      PI_SKIP_VERSION_CHECK = "1";
      # Never silently create unsigned commits because host gitconfig is hidden.
      GIT_CONFIG_COUNT = "1";
      GIT_CONFIG_KEY_0 = "commit.gpgsign";
      GIT_CONFIG_VALUE_0 = "true";
    };
  };
  piEntry = pkgs.writeShellScriptBin "pi-pilot" ''
    # Pi dispatches subcommands only when they precede session flags.
    if [ "''${1-}" = auth ] && [ "''${2-}" = check ]; then
      exec ${lib.getExe pkgs.nodejs_24} "${cli}" "$@"
    fi
    case "''${1-}" in
      install|remove|uninstall|update|list|config|auth|mcp)
        echo 'Only sessions and auth check are supported; manage Pi on the host.' >&2
        exit 64
        ;;
    esac
    exec ${lib.getExe pkgs.nodejs_24} "${cli}" \
      --no-approve --no-mcp --no-extensions --no-context-files \
      --no-skills --no-prompt-templates --no-themes \
      --append-system-prompt ${instructions} "$@"
  '';
  confinedPi = confine {
    pkg = piEntry;
    binName = "pi-pilot";
    outName = "pi-pilot-confined";
  };
  probeEntry = pkgs.writeShellScriptBin "pi-sandbox-probe-entry" ''
    exec ${lib.getExe pkgs.python3} ${../../../tests/test-agent-sandbox.py} --inside "$@"
  '';
  probe = confine {
    pkg = probeEntry;
    binName = "pi-sandbox-probe-entry";
    outName = "pi-sandbox-probe";
  };
  prepareState = ''
    mkdir -p "${agentDir}"
    chmod 700 "${agentDir}"
  '';
  probeCommand = pkgs.writeShellApplication {
    name = "pi-sandbox-probe";
    runtimeInputs = [ pkgs.coreutils ];
    text = prepareState + ''
      exec ${lib.getExe probe} "$@"
    '';
  };
  launch = pkgs.writeShellApplication {
    name = "pi-sandboxed";
    runtimeInputs = [ pkgs.git pkgs.coreutils ];
    text = ''
      root="$(git rev-parse --show-toplevel)"
      if [ "$(pwd -P)" != "$(realpath "$root")" ] || [ ! -f "$root/.git" ]; then
        echo 'Launch pi-sandboxed at the root of a prepared linked worktree.' >&2
        exit 64
      fi
      # Never let a linked worktree containing HOME become the workspace grant.
      case "$(realpath "$HOME")/" in
        "$(realpath "$root")/"*)
          echo 'Refusing a workspace that contains your home directory.' >&2
          exit 64
          ;;
      esac
      if [ ! -r "${cli}" ]; then
        echo 'This pilot requires the existing ~/.local/share/pi-npm Pi runtime.' >&2
        exit 69
      fi
      ${prepareState}
      echo 'Restricted pilot: dedicated Pi state; no Nix/MCP, signing or host credentials.' >&2
      exec ${lib.getExe confinedPi} "$@"
    '';
  };
in
{
  assertions = [{
    assertion = pkgs.stdenv.isDarwin;
    message = "The agent-sandbox pilot is currently verified only on macOS.";
  }];
  packages = [ launch ];
  env.PI_SANDBOX_PROBE = lib.getExe probeCommand;
  env.PI_SANDBOX_COMMAND = lib.getExe launch;
}
