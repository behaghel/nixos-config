# Claude Code notification hooks for macOS.
# Sends desktop notifications when Claude needs attention or finishes a task.
# Prefer the repo's native hub-notify wrapper.
#
# Usage in devenv.nix:
#   claude.code.hooks = import (inputs.agent-marketplace + "/marketplace/hooks/notification.nix");
{
  notify-idle = {
    hookType = "Notification";
    matcher = "idle_prompt|permission_prompt";
    command = "hub-notify --sound Submarine 'Claude Code' 'Needs your attention' || osascript -e 'display notification \"Needs your attention\" with title \"Claude Code\" sound name \"Submarine\"' 2>/dev/null || true";
  };
  notify-stop = {
    hookType = "Stop";
    matcher = ".*";
    command = "hub-notify --sound Glass 'Claude Code' 'Task complete' || osascript -e 'display notification \"Task complete\" with title \"Claude Code\" sound name \"Glass\"' 2>/dev/null || true";
  };
}
