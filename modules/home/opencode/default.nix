{ pkgs, lib, config, ... }:

let
  cfg = config.hub.opencode;
in
{
  options.hub.opencode.modelConfigMode = lib.mkOption {
    type = lib.types.enum [ "native" "sans-claude" "openai-only" "gemini-only" ];
    default = "sans-claude";
    description = ''
      Selects how Home Manager manages the oh-my-openagent model mapping.

      - native: do not manage `opencode/oh-my-openagent.json`
      - sans-claude: use the repo's current mixed OpenAI/Gemini config
      - openai-only: use an OpenAI-only model map for all roles/categories
      - gemini-only: use a Gemini-only model map for all roles/categories
    '';
  };

  options.hub.opencode.context7 = {
    enable = lib.mkEnableOption "Context7 API key injection for OpenCode";

    passEntry = lib.mkOption {
      type = lib.types.str;
      default = "dev/context7-api-key";
      description = "Password-store entry used to populate CONTEXT7_API_KEY for OpenCode.";
    };
  };

  config = {
    home.packages = [
      pkgs.nodejs
    ];

    xdg.configFile."opencode/plugins/session-notify.js" = {
      text = ''
        import { spawn } from "node:child_process"

        const lastNotified = new Map()

        function trySpawn(command, args) {
          try {
            const child = spawn(command, args, {
              detached: true,
              stdio: "ignore",
            })
            child.unref()
            return true
          } catch {
            return false
          }
        }

        function escapeAppleScript(text) {
          return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        }

        export const SessionNotifyPlugin = async () => {
          return {
            event: async ({ event }) => {
              if (event?.type !== "session.idle") return

              const sessionID = event?.properties?.sessionID ?? "default"
              const now = Date.now()
              const last = lastNotified.get(sessionID) ?? 0
              if (now - last < 1500) return
              lastNotified.set(sessionID, now)

              const title = "OpenCode"
              const body = "Response ready"

              const inTmux = Boolean(process.env.TMUX)
              if (!inTmux) {
                let delivered = trySpawn("terminal-notifier", ["-title", title, "-message", body])
                if (!delivered) delivered = trySpawn("notify-send", [title, body])
                if (!delivered) {
                  const escTitle = escapeAppleScript(title)
                  const escBody = escapeAppleScript(body)
                  trySpawn("/usr/bin/osascript", ["-e", `display notification \"''${escBody}\" with title \"''${escTitle}\"`])
                }
              }

              try {
                process.stdout.write("\u0007")
              } catch {}
            },
          }
        }
      '';
    };

    xdg.configFile."opencode/opencode.json" = {
      source = ./opencode.json;
    };

    xdg.configFile."opencode/oh-my-openagent.json" = lib.mkIf (cfg.modelConfigMode != "native") {
      source = {
        "sans-claude" = ./oh-my-openagent.json;
        "openai-only" = ./oh-my-openagent-openai-only.json;
        "gemini-only" = ./oh-my-openagent-gemini-only.json;
      }.${cfg.modelConfigMode};
    };

    hub.passLaunchers = lib.mkIf cfg.context7.enable {
      opencode = {
        enable = true;
        lookupCommand = "opencode";
        fallbackCandidates = [
          "/opt/homebrew/bin/opencode"
          "/usr/local/bin/opencode"
        ];
        passEnv.CONTEXT7_API_KEY = cfg.context7.passEntry;
      };
    };
  };

}
