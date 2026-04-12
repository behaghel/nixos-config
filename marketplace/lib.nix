# Auto-discovery helper for the agent marketplace.
#
# Provides per-plugin access, named bundles, and a select helper.
# Importing the marketplace does NOT activate any plugin — consumers opt in.
#
# Usage in a project's devenv.nix:
#   let
#     mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
#     bundle = mp.bundles.total-spec;
#   in {
#     opencode = {
#       enable = true;
#       skills = mp.skills // bundle.skills;
#       commands = bundle.commands;
#       agents = bundle.agents;
#     };
#     claude.code = {
#       enable = true;
#       commands = bundle.commands;
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

  # ── Per-plugin discovery ────────────────────────────────────

  pluginNames =
    if builtins.pathExists pluginsDir
    then builtins.attrNames (lib.filterAttrs (_: t: t == "directory") (builtins.readDir pluginsDir))
    else [ ];

  # Build a single plugin's attrset: { skills, commands, agents }
  mkPlugin = name:
    let
      base = pluginsDir + "/${name}";
      skillsPath = base + "/skills";
      cmdsPath = base + "/commands";
      agentsPath = base + "/agents";
    in
    {
      skills =
        if builtins.pathExists skillsPath
        then lib.mapAttrs'
          (sName: _: lib.nameValuePair sName (skillsPath + "/${sName}"))
          (lib.filterAttrs (_: t: t == "directory") (builtins.readDir skillsPath))
        else { };

      commands =
        if builtins.pathExists cmdsPath
        then lib.mapAttrs'
          (fName: _:
            lib.nameValuePair
              (lib.removeSuffix ".md" fName)
              (builtins.readFile (cmdsPath + "/${fName}")))
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n) (builtins.readDir cmdsPath))
        else { };

      agents =
        if builtins.pathExists agentsPath
        then lib.mapAttrs'
          (fName: _:
            lib.nameValuePair
              (lib.removeSuffix ".md" fName)
              (stripFrontmatter (builtins.readFile (agentsPath + "/${fName}"))))
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n) (builtins.readDir agentsPath))
        else { };
    };

  # All plugins as attrset: { spec-tdd = { skills, commands, agents }; ... }
  plugins = lib.genAttrs pluginNames mkPlugin;

  # ── Select helper ───────────────────────────────────────────

  # Merge a list of plugin names into a single { skills, commands, agents }.
  select = names:
    let
      selected = map (n:
        if builtins.hasAttr n plugins
        then plugins.${n}
        else throw "marketplace: unknown plugin '${n}'. Available: ${builtins.concatStringsSep ", " pluginNames}"
      ) names;
    in
    {
      skills = lib.mergeAttrsList (map (p: p.skills) selected);
      commands = lib.mergeAttrsList (map (p: p.commands) selected);
      agents = lib.mergeAttrsList (map (p: p.agents) selected);
    };

  # ── Standalone skills ───────────────────────────────────────

  standaloneSkills =
    if builtins.pathExists skillsDir
    then lib.mapAttrs'
      (sName: _: lib.nameValuePair sName (skillsDir + "/${sName}"))
      (lib.filterAttrs (_: t: t == "directory") (builtins.readDir skillsDir))
    else { };

in
{
  # Per-plugin access. Each plugin exposes { skills, commands, agents }.
  inherit plugins;

  # Merge an arbitrary list of plugins by name.
  inherit select;

  # Named bundles.
  bundles = {
    # spec-driven + spec-tdd + domain-tree + ux-stories
    total-spec = select [ "spec-driven" "spec-tdd" "domain-tree" "ux-stories" ];
  };

  # Standalone skills (not part of any plugin). Always safe to include.
  skills = standaloneSkills;

  # Shared memory / rules.
  memory = builtins.readFile ./memory.md;

  # Hook and MCP attrsets, importable directly.
  hooks = import ./hooks/notification.nix;
  mcpServers = {
    devenv = import ./mcp/devenv.nix;
  };
}
