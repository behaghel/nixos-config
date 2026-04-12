# Auto-discovery helper for the agent marketplace.
#
# Scans plugins/ and skills/ directories and produces tool-agnostic
# attrsets that devenv's claude.code.* and opencode.* modules consume.
#
# Usage in a project's devenv.nix:
#   let
#     mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
#   in {
#     opencode = {
#       enable = true;
#       skills = mp.skills;
#       commands = mp.commands;
#       agents = mp.agents;
#     };
#     claude.code = {
#       enable = true;
#       commands = mp.commands;
#       hooks = mp.hooks;
#       mcpServers.devenv = mp.mcpServers.devenv;
#     };
#   };

{ lib }:

let
  pluginsDir = ./plugins;
  skillsDir = ./skills;

  # Strip YAML frontmatter (--- ... ---) from markdown content.
  # Agent .md files use Claude Code frontmatter fields (color, tools, model)
  # that are incompatible with OpenCode. Stripping the frontmatter keeps
  # only the prompt body, which is tool-agnostic.
  stripFrontmatter = content:
    let
      lines = lib.splitString "\n" content;
      indexed = lib.imap0 (i: line: { inherit i line; }) lines;
      dashes = builtins.filter (x: x.line == "---") indexed;
      afterFrontmatter =
        if builtins.length dashes >= 2
        then lib.drop ((builtins.elemAt dashes 1).i + 1) lines
        else lines;
    in
    lib.concatStringsSep "\n" afterFrontmatter;

  pluginNames =
    if builtins.pathExists pluginsDir
    then builtins.attrNames (lib.filterAttrs (_: t: t == "directory") (builtins.readDir pluginsDir))
    else [ ];

  # Collect skills from plugins/<name>/skills/<skill-name>/ (directories)
  pluginSkills = lib.mergeAttrsList (map
    (name:
      let path = pluginsDir + "/${name}/skills";
      in lib.optionalAttrs (builtins.pathExists path)
        (lib.mapAttrs'
          (sName: _: lib.nameValuePair sName (path + "/${sName}"))
          (lib.filterAttrs (_: t: t == "directory") (builtins.readDir path))))
    pluginNames);

  # Collect standalone skills from skills/<skill-name>/
  standaloneSkills =
    if builtins.pathExists skillsDir
    then lib.mapAttrs'
      (sName: _: lib.nameValuePair sName (skillsDir + "/${sName}"))
      (lib.filterAttrs (_: t: t == "directory") (builtins.readDir skillsDir))
    else { };

  # Collect commands from plugins/<name>/commands/*.md
  pluginCommands = lib.mergeAttrsList (map
    (name:
      let path = pluginsDir + "/${name}/commands";
      in lib.optionalAttrs (builtins.pathExists path)
        (lib.mapAttrs'
          (fName: _:
            lib.nameValuePair
              (lib.removeSuffix ".md" fName)
              (builtins.readFile (path + "/${fName}")))
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n) (builtins.readDir path))))
    pluginNames);

  # Collect agents from plugins/<name>/agents/*.md
  # Frontmatter is stripped so the content is tool-agnostic.
  pluginAgents = lib.mergeAttrsList (map
    (name:
      let path = pluginsDir + "/${name}/agents";
      in lib.optionalAttrs (builtins.pathExists path)
        (lib.mapAttrs'
          (fName: _:
            lib.nameValuePair
              (lib.removeSuffix ".md" fName)
              (stripFrontmatter (builtins.readFile (path + "/${fName}"))))
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n) (builtins.readDir path))))
    pluginNames);

in
{
  # All skills (standalone + from plugins). Attrset of name -> path.
  skills = standaloneSkills // pluginSkills;

  # All commands (from plugins). Attrset of name -> markdown content.
  commands = pluginCommands;

  # All agents (from plugins). Attrset of name -> markdown content.
  agents = pluginAgents;

  # Shared memory / rules.
  memory = builtins.readFile ./memory.md;

  # Hook and MCP attrsets, importable directly.
  hooks = import ./hooks/notification.nix;
  mcpServers = {
    devenv = import ./mcp/devenv.nix;
  };
}
