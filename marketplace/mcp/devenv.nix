# Shared devenv MCP server definition.
# Provides search_packages and search_options tools.
#
# Usage in devenv.nix:
#   claude.code.mcpServers.devenv = import (inputs.agent-marketplace + "/marketplace/mcp/devenv.nix");
{
  command = "devenv";
  args = [ "mcp" ];
}
