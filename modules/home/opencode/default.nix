{ pkgs, ... }:

{
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

  xdg.configFile."opencode/oh-my-openagent.json" = {
    source = ./oh-my-openagent.json;
  };
}
