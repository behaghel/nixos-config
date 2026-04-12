# Claude Code notification hooks for macOS.
# Sends desktop notifications when Claude needs attention or finishes a task.
#
# Usage in devenv.nix:
#   claude.code.hooks = import (inputs.agent-marketplace + "/marketplace/hooks/notification.nix");
{
  notify-idle = {
    hookType = "Notification";
    matcher = "idle_prompt|permission_prompt";
    command = "terminal-notifier -title 'Claude Code' -message 'Needs your attention' -sound Submarine || osascript -e 'display notification \"Needs your attention\" with title \"Claude Code\" sound name \"Submarine\"' 2>/dev/null || true";
  };
  notify-stop = {
    hookType = "Stop";
    matcher = ".*";
    command = "terminal-notifier -title 'Claude Code' -message 'Task complete' -sound Glass || osascript -e 'display notification \"Task complete\" with title \"Claude Code\" sound name \"Glass\"' 2>/dev/null || true";
  };
}
