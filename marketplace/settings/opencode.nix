# Shared OpenCode settings.
#
# Usage in devenv.nix:
#   opencode.settings = import (inputs.agent-marketplace + "/marketplace/settings/opencode.nix");
{
  experimental = {
    mcp_timeout = 20000;
  };
}
