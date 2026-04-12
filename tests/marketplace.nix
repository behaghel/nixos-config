# Marketplace tests — evaluation, schema, and template wiring.
#
# Level 1: lib.nix auto-discovery returns expected skills, commands, agents.
# Level 2: Every plugin has the expected directory structure.
# Level 3: Every template's devenv.nix evaluates with the marketplace wired in.
#
# Runs as: nix flake check (checks.aarch64-darwin.marketplace)

{ pkgs, lib }:

let
  mp = import ../marketplace/lib.nix { inherit lib; };
  marketplaceDir = ../marketplace;

  # ── Helpers ──────────────────────────────────────────────────
  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  assertHasAttr = set: attr: name:
    assert' name (builtins.hasAttr attr set);

  assertNonEmpty = set: name:
    assert' name (builtins.attrNames set != [ ]);

  assertIsString = val: name:
    assert' name (builtins.isString val);

  assertPathExists = path: name:
    assert' name (builtins.pathExists path);

  # ── Level 1: lib.nix auto-discovery ─────────────────────────
  level1 =
    let
      skillNames = builtins.attrNames mp.skills;
      commandNames = builtins.attrNames mp.commands;
      agentNames = builtins.attrNames mp.agents;
    in
    # Skills
    assertNonEmpty mp.skills "lib.nix discovers at least one skill"
    + assertHasAttr mp.skills "devenv-project-workflow" "standalone skill: devenv-project-workflow"
    + assertHasAttr mp.skills "tdd-planner" "plugin skill: tdd-planner (spec-tdd)"
    + assertHasAttr mp.skills "domain-navigator" "plugin skill: domain-navigator (domain-tree)"
    + assertHasAttr mp.skills "story-writer" "plugin skill: story-writer (ux-stories)"
    # Commands
    + assertNonEmpty mp.commands "lib.nix discovers at least one command"
    + assertHasAttr mp.commands "plan" "command: plan (spec-tdd)"
    + assertHasAttr mp.commands "iterate" "command: iterate (spec-tdd)"
    + assertHasAttr mp.commands "check" "command: check (domain-tree)"
    + assertHasAttr mp.commands "init" "command: init (domain-tree)"
    + assertHasAttr mp.commands "map" "command: map (domain-tree)"
    + assertHasAttr mp.commands "write" "command: write (ux-stories)"
    + assertHasAttr mp.commands "scenarios" "command: scenarios (ux-stories)"
    + assertHasAttr mp.commands "deliver" "command: deliver (ux-stories)"
    # Agents
    + assertNonEmpty mp.agents "lib.nix discovers at least one agent"
    + assertHasAttr mp.agents "tdd-coach" "agent: tdd-coach (spec-tdd)"
    + assertHasAttr mp.agents "boundary-enforcer" "agent: boundary-enforcer (domain-tree)"
    + assertHasAttr mp.agents "story-guardian" "agent: story-guardian (ux-stories)"
    # Content is string (not path)
    + assertIsString (mp.commands.plan) "command content is string"
    + assertIsString (mp.agents.tdd-coach) "agent content is string"
    + assertIsString mp.memory "memory is string"
    # Hooks and MCP are attrsets
    + assert' "hooks has notify-idle" (builtins.hasAttr "notify-idle" mp.hooks)
    + assert' "hooks has notify-stop" (builtins.hasAttr "notify-stop" mp.hooks)
    + assert' "mcpServers has devenv" (builtins.hasAttr "devenv" mp.mcpServers);

  # ── Level 2: Plugin schema validation ───────────────────────
  pluginNames = builtins.attrNames
    (lib.filterAttrs (_: t: t == "directory")
      (builtins.readDir (marketplaceDir + "/plugins")));

  validatePlugin = name:
    let
      base = marketplaceDir + "/plugins/${name}";
      hasSkills = builtins.pathExists (base + "/skills");
      hasCommands = builtins.pathExists (base + "/commands");
      hasAgents = builtins.pathExists (base + "/agents");
      hasReadme = builtins.pathExists (base + "/README.md");

      # Each skill dir must have SKILL.md
      skillDirs =
        if hasSkills
        then builtins.attrNames
          (lib.filterAttrs (_: t: t == "directory")
            (builtins.readDir (base + "/skills")))
        else [ ];
      skillChecks = lib.concatMapStrings
        (sName:
          assertPathExists
            (base + "/skills/${sName}/SKILL.md")
            "plugin ${name}: skills/${sName}/SKILL.md exists")
        skillDirs;

      # Each command must be a .md file
      commandFiles =
        if hasCommands
        then builtins.attrNames
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n)
            (builtins.readDir (base + "/commands")))
        else [ ];
      commandChecks = lib.concatMapStrings
        (fName:
          assert' "plugin ${name}: commands/${fName} is markdown"
            (lib.hasSuffix ".md" fName))
        commandFiles;

      # Each agent must be a .md file
      agentFiles =
        if hasAgents
        then builtins.attrNames
          (lib.filterAttrs (n: _: lib.hasSuffix ".md" n)
            (builtins.readDir (base + "/agents")))
        else [ ];
      agentChecks = lib.concatMapStrings
        (fName:
          assert' "plugin ${name}: agents/${fName} is markdown"
            (lib.hasSuffix ".md" fName))
        agentFiles;
    in
    assert' "plugin ${name}: has README.md" hasReadme
    + assert' "plugin ${name}: has at least one of skills/, commands/, agents/"
        (hasSkills || hasCommands || hasAgents)
    + assert' "plugin ${name}: has skills/" hasSkills
    + skillChecks
    + commandChecks
    + agentChecks;

  level2 = lib.concatMapStrings validatePlugin pluginNames;

  # ── Level 3: Template devenv.nix evaluates with marketplace ─
  templateNames = builtins.attrNames
    (lib.filterAttrs (_: t: t == "directory")
      (builtins.readDir ../templates));

  validateTemplate = name:
    let
      devenvNix = ../templates + "/${name}/devenv.nix";
      devenvYaml = ../templates + "/${name}/devenv.yaml";
      hasDevenvNix = builtins.pathExists devenvNix;
      hasDevenvYaml = builtins.pathExists devenvYaml;
      # Read the devenv.nix source and check it references the marketplace
      devenvContent =
        if hasDevenvNix
        then builtins.readFile devenvNix
        else "";
      refsMarketplace = builtins.match ".*agent-marketplace.*" devenvContent != null;
      refsLibNix = builtins.match ".*lib\\.nix.*" devenvContent != null;
      refsClaude = builtins.match ".*claude\\.code.*" devenvContent != null;
      refsOpencode = builtins.match ".*opencode.*" devenvContent != null;
      # Read devenv.yaml and check it has the marketplace input
      yamlContent =
        if hasDevenvYaml
        then builtins.readFile devenvYaml
        else "";
      yamlRefsMarketplace = builtins.match ".*agent-marketplace.*" yamlContent != null;
    in
    assert' "template ${name}: devenv.nix exists" hasDevenvNix
    + assert' "template ${name}: devenv.yaml exists" hasDevenvYaml
    + assert' "template ${name}: devenv.yaml has agent-marketplace input" yamlRefsMarketplace
    + assert' "template ${name}: devenv.nix references agent-marketplace" refsMarketplace
    + assert' "template ${name}: devenv.nix uses lib.nix" refsLibNix
    + assert' "template ${name}: devenv.nix enables claude.code" refsClaude
    + assert' "template ${name}: devenv.nix enables opencode" refsOpencode;

  level3 = lib.concatMapStrings validateTemplate templateNames;

  # ── Combine all levels ──────────────────────────────────────
  allResults = level1 + level2 + level3;

in
pkgs.runCommand "marketplace-tests" { } ''
  cat <<'RESULTS'
  ── Level 1: lib.nix auto-discovery ──
  ${level1}
  ── Level 2: Plugin schema ──
  ${level2}
  ── Level 3: Template wiring ──
  ${level3}
  RESULTS
  echo "All marketplace tests passed."
  echo ok > $out
''
