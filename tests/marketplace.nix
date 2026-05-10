# Marketplace tests — evaluation, schema, and template wiring.
#
# Level 1: Per-plugin access, bundles, select helper, standalone skills.
# Level 2: Every plugin has the expected directory structure.
# Level 3: Every template's devenv.nix uses explicit opt-in (bundles, not auto-merge).
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

  assertNoAttr = set: attr: name:
    assert' name (!(builtins.hasAttr attr set));

  assertNonEmpty = set: name:
    assert' name (builtins.attrNames set != [ ]);

  assertIsString = val: name:
    assert' name (builtins.isString val);

  assertPathExists = path: name:
    assert' name (builtins.pathExists path);

  assertEq = a: b: name:
    assert' name (a == b);

  # ── Level 1: lib.nix API ────────────────────────────────────

  level1-plugins =
    # Per-plugin access
    assertHasAttr mp.plugins "spec-driven" "plugin exists: spec-driven"
    + assertHasAttr mp.plugins "spec-tdd" "plugin exists: spec-tdd"
    + assertHasAttr mp.plugins "domain-tree" "plugin exists: domain-tree"
    + assertHasAttr mp.plugins "ux-stories" "plugin exists: ux-stories"
    + assertHasAttr mp.plugins "devenv-workflow" "plugin exists: devenv-workflow"
    # Per-plugin skills
    + assertHasAttr mp.plugins.spec-driven.skills "spec-collector" "spec-driven has skill: spec-collector"
    + assertHasAttr mp.plugins.spec-driven.skills "spec-verifier" "spec-driven has skill: spec-verifier"
    + assertHasAttr mp.plugins.spec-tdd.skills "tdd-planner" "spec-tdd has skill: tdd-planner"
    + assertHasAttr mp.plugins.domain-tree.skills "domain-navigator" "domain-tree has skill: domain-navigator"
    + assertHasAttr mp.plugins.ux-stories.skills "story-writer" "ux-stories has skill: story-writer"
    + assertHasAttr mp.plugins.devenv-workflow.skills "devenv-project" "devenv-workflow has skill: devenv-project"
    # Per-plugin commands
    + assertHasAttr mp.plugins.spec-driven.commands "spec-collect" "spec-driven has command: spec-collect"
    + assertHasAttr mp.plugins.spec-tdd.commands "tdd-plan" "spec-tdd has command: tdd-plan"
    + assertHasAttr mp.plugins.spec-tdd.commands "tdd-iterate" "spec-tdd has command: tdd-iterate"
    + assertHasAttr mp.plugins.domain-tree.commands "domain-check" "domain-tree has command: domain-check"
    + assertHasAttr mp.plugins.domain-tree.commands "domain-init" "domain-tree has command: domain-init"
    + assertHasAttr mp.plugins.domain-tree.commands "domain-map" "domain-tree has command: domain-map"
    + assertHasAttr mp.plugins.ux-stories.commands "story-write" "ux-stories has command: story-write"
    + assertHasAttr mp.plugins.ux-stories.commands "story-scenarios" "ux-stories has command: story-scenarios"
    + assertHasAttr mp.plugins.ux-stories.commands "story-deliver" "ux-stories has command: story-deliver"
    + assertHasAttr mp.plugins.devenv-workflow.commands "devenv-init" "devenv-workflow has command: devenv-init"
    + assertHasAttr mp.plugins.devenv-workflow.commands "devenv-diagnose" "devenv-workflow has command: devenv-diagnose"
    + assertHasAttr mp.plugins.devenv-workflow.commands "devenv-add" "devenv-workflow has command: devenv-add"
    # Per-plugin agents
    + assertHasAttr mp.plugins.spec-driven.agents "spec-challenger" "spec-driven has agent: spec-challenger"
    + assertHasAttr mp.plugins.spec-tdd.agents "tdd-coach" "spec-tdd has agent: tdd-coach"
    + assertHasAttr mp.plugins.domain-tree.agents "boundary-enforcer" "domain-tree has agent: boundary-enforcer"
    + assertHasAttr mp.plugins.ux-stories.agents "story-guardian" "ux-stories has agent: story-guardian"
    + assertHasAttr mp.plugins.devenv-workflow.agents "devenv-expert" "devenv-workflow has agent: devenv-expert"
    # Content types
    + assertIsString mp.plugins.spec-tdd.commands.tdd-plan "command content is string"
    + assertIsString mp.plugins.spec-tdd.agents.tdd-coach "agent content is string (frontmatter stripped)";

  level1-bundle =
    let bundle = mp.bundles.total-spec;
    in
    # total-spec bundle contains all 4 plugins
    assertNonEmpty bundle.skills "total-spec bundle has skills"
    + assertNonEmpty bundle.commands "total-spec bundle has commands"
    + assertNonEmpty bundle.agents "total-spec bundle has agents"
    + assertHasAttr bundle.skills "spec-collector" "bundle has spec-collector (spec-driven)"
    + assertHasAttr bundle.skills "tdd-planner" "bundle has tdd-planner (spec-tdd)"
    + assertHasAttr bundle.skills "domain-navigator" "bundle has domain-navigator (domain-tree)"
    + assertHasAttr bundle.skills "story-writer" "bundle has story-writer (ux-stories)"
    + assertHasAttr bundle.commands "spec-collect" "bundle has spec-collect (spec-driven)"
    + assertHasAttr bundle.commands "tdd-plan" "bundle has tdd-plan (spec-tdd)"
    + assertHasAttr bundle.commands "domain-check" "bundle has domain-check (domain-tree)"
    + assertHasAttr bundle.commands "story-write" "bundle has story-write (ux-stories)"
    + assertHasAttr bundle.agents "spec-challenger" "bundle has spec-challenger (spec-driven)"
    + assertHasAttr bundle.agents "tdd-coach" "bundle has tdd-coach (spec-tdd)"
    + assertHasAttr bundle.agents "boundary-enforcer" "bundle has boundary-enforcer (domain-tree)"
    + assertHasAttr bundle.agents "story-guardian" "bundle has story-guardian (ux-stories)";

  level1-select =
    let
      one = mp.select [ "spec-tdd" ];
      two = mp.select [ "spec-tdd" "domain-tree" ];
    in
    # Select single plugin
    assertHasAttr one.skills "tdd-planner" "select [spec-tdd] has tdd-planner"
    + assertHasAttr one.commands "tdd-plan" "select [spec-tdd] has tdd-plan command"
    + assertNoAttr one.skills "domain-navigator" "select [spec-tdd] does NOT have domain-navigator"
    # Select multiple
    + assertHasAttr two.skills "tdd-planner" "select [spec-tdd,domain-tree] has tdd-planner"
    + assertHasAttr two.skills "domain-navigator" "select [spec-tdd,domain-tree] has domain-navigator"
    + assertNoAttr two.skills "story-writer" "select [spec-tdd,domain-tree] does NOT have story-writer";

  level1-standalone =
    # Standalone skills (currently none — devenv-project-workflow moved to plugin)
    assertNoAttr mp.skills "tdd-planner" "standalone skills do NOT include plugin skills"
    + assertNoAttr mp.skills "devenv-project" "devenv-project is in plugin, not standalone";

  level1-no-auto-merge =
    # Top-level mp should NOT have auto-merged commands/agents
    assertNoAttr mp "commands" "no top-level mp.commands (explicit opt-in only)"
    + assertNoAttr mp "agents" "no top-level mp.agents (explicit opt-in only)";

  level1-shared =
    let
      marketplaceReadme = builtins.readFile (marketplaceDir + "/README.md");
      rawDevenvExpert = builtins.readFile (marketplaceDir + "/plugins/devenv-workflow/agents/devenv-expert.md");
      renderedDevenvExpert = mp.plugins.devenv-workflow.agents.devenv-expert;
      piExtension = builtins.readFile (marketplaceDir + "/plugins/devenv-workflow/pi/extension.ts");
    in
    assertIsString mp.memory "memory is string"
    + assert' "hooks has notify-idle" (builtins.hasAttr "notify-idle" mp.hooks)
    + assert' "hooks has notify-stop" (builtins.hasAttr "notify-stop" mp.hooks)
    + assert' "mcpServers has devenv" (builtins.hasAttr "devenv" mp.mcpServers)
    + assert' "mcpServers.devenv has type" (builtins.hasAttr "type" mp.mcpServers.devenv)
    + assert' "marketplace README keeps shared-vs-consumer boundary" (
      builtins.match ".*shared markdown assets first.*" marketplaceReadme != null
      && builtins.match ".*consumer adapters .*runtime detection, tool registration, interception, and UI glue only.*" marketplaceReadme != null
    )
    + assert' "devenv-workflow raw agent keeps frontmatter" (
      builtins.match ".*model: haiku.*" rawDevenvExpert != null
    )
    + assert' "devenv-workflow rendered agent strips frontmatter" (
      builtins.match ".*model: haiku.*" renderedDevenvExpert == null
      && builtins.match ".*You are a devenv environment expert\..*" renderedDevenvExpert != null
    )
    + assert' "Pi extension points durable guidance to shared markdown" (
      lib.hasInfix "### Shared troubleshooting knowledge" piExtension
      && lib.hasInfix "shared \\`devenv-project\\` skill and \\`/devenv-diagnose\\` command" piExtension
    );

  level1 = level1-plugins + level1-bundle + level1-select + level1-standalone + level1-no-auto-merge + level1-shared;

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

  # ── Level 2.5: Pi extension syntax ──────────────────────────
  piExtensionPaths = builtins.filter builtins.pathExists [
    (marketplaceDir + "/plugins/devenv-workflow/pi/extension.ts")
    (marketplaceDir + "/plugins/domain-tree/pi/extension.ts")
    (marketplaceDir + "/plugins/spec-driven/pi/extension.ts")
    (marketplaceDir + "/plugins/spec-tdd/pi/extension.ts")
    (marketplaceDir + "/plugins/ux-stories/pi/extension.ts")
  ];

  piSyntaxCheck = pkgs.runCommand "marketplace-pi-extension-syntax" {
    nativeBuildInputs = [ pkgs.nodejs ];
  } ''
    set -euo pipefail

    ${lib.concatMapStringsSep "\n" (path: ''
      node --check ${lib.escapeShellArg (toString path)}
    '') piExtensionPaths}

    echo ok > "$out"
  '';

  level25 = assertPathExists piSyntaxCheck "pi extensions parse with node --check";

  # ── Level 3: Template wiring (explicit opt-in) ──────────────
  templateNames = builtins.attrNames
    (lib.filterAttrs (_: t: t == "directory")
      (builtins.readDir ../templates));

  validateTemplate = name:
    let
      devenvNix = ../templates + "/${name}/devenv.nix";
      devenvYaml = ../templates + "/${name}/devenv.yaml";
      hasDevenvNix = builtins.pathExists devenvNix;
      hasDevenvYaml = builtins.pathExists devenvYaml;
      devenvContent =
        if hasDevenvNix
        then builtins.readFile devenvNix
        else "";
      yamlContent =
        if hasDevenvYaml
        then builtins.readFile devenvYaml
        else "";
      refsMarketplace = builtins.match ".*agent-marketplace.*" devenvContent != null;
      refsLibNix = builtins.match ".*lib\\.nix.*" devenvContent != null;
      refsClaude = builtins.match ".*claude\\.code.*" devenvContent != null;
      refsOpencode = builtins.match ".*opencode.*" devenvContent != null;
      refsBundle = builtins.match ".*bundles\\.total-spec.*" devenvContent != null;
      yamlRefsMarketplace = builtins.match ".*agent-marketplace.*" yamlContent != null;
    in
    assert' "template ${name}: devenv.nix exists" hasDevenvNix
    + assert' "template ${name}: devenv.yaml exists" hasDevenvYaml
    + assert' "template ${name}: devenv.yaml has agent-marketplace input" yamlRefsMarketplace
    + assert' "template ${name}: devenv.nix references agent-marketplace" refsMarketplace
    + assert' "template ${name}: devenv.nix uses lib.nix" refsLibNix
    + assert' "template ${name}: devenv.nix enables claude.code" refsClaude
    + assert' "template ${name}: devenv.nix enables opencode" refsOpencode
    + assert' "template ${name}: devenv.nix uses explicit bundle (not auto-merge)" refsBundle;

  level3 = lib.concatMapStrings validateTemplate templateNames;

in
pkgs.runCommand "marketplace-tests" { } ''
  cat <<'RESULTS'
  ── Level 1: Per-plugin access ──
  ${level1-plugins}
  ── Level 1: total-spec bundle ──
  ${level1-bundle}
  ── Level 1: select helper ──
  ${level1-select}
  ── Level 1: standalone skills ──
  ${level1-standalone}
  ── Level 1: no auto-merge ──
  ${level1-no-auto-merge}
  ── Level 1: shared infra ──
  ${level1-shared}
  ── Level 2: Plugin schema ──
  ${level2}
  ── Level 2.5: Pi extension syntax ──
  ${level25}
  ── Level 3: Template wiring ──
  ${level3}
  RESULTS
  echo "All marketplace tests passed."
  echo ok > $out
''
