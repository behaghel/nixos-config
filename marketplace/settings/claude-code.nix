# Shared Claude Code settings.
#
# Usage in devenv.nix:
#   claude.code.settings = import (inputs.agent-marketplace + "/marketplace/settings/claude-code.nix");
{
  includeCoAuthoredBy = false;
}
