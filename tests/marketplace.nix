# Native Pi package/resource validation. There is no generated-client exporter.
{ pkgs, lib }:
let
  marketplaceDir = ../marketplace;
  assert' = name: condition:
    if condition then "  ok  ${name}\n" else abort "FAIL ${name}";
  pluginNames = builtins.attrNames
    (lib.filterAttrs (_: type: type == "directory")
      (builtins.readDir (marketplaceDir + "/plugins")));

  validatePlugin = name:
    let
      base = marketplaceDir + "/plugins/${name}";
      manifest = builtins.fromJSON (builtins.readFile (base + "/package.json"));
      pi = manifest.pi;
      resourceChecks = lib.concatMapStrings
        (resource: assert' "${name}: resource ${resource} exists"
          (builtins.pathExists (base + "/${resource}")))
        (pi.extensions ++ pi.skills);
      skills = builtins.attrNames (lib.filterAttrs (_: type: type == "directory")
        (builtins.readDir (base + "/skills")));
    in
    assert' "${name}: README exists" (builtins.pathExists (base + "/README.md"))
    + assert' "${name}: package has a name and version"
      (manifest ? name && manifest ? version)
    + assert' "${name}: declares native extensions and skills"
      (pi.extensions != [ ] && pi.skills != [ ])
    + assert' "${name}: retired plugin manifest is absent"
      (!(builtins.pathExists (base + "/.claude-plugin")))
    + resourceChecks
    + lib.concatMapStrings
      (skill: assert' "${name}: ${skill} has SKILL.md"
        (builtins.pathExists (base + "/skills/${skill}/SKILL.md")))
      skills;

  catalogueChecks =
    lib.concatMapStrings
      (name: assert' "plugin exists: ${name}" (builtins.elem name pluginNames))
      [ "devenv-workflow" "domain-tree" "spec-driven" "spec-tdd" "ux-stories" ]
    + lib.concatMapStrings validatePlugin pluginNames
    + assert' "standalone grill-me skill exists"
      (builtins.pathExists (marketplaceDir + "/skills/grill-me/SKILL.md"))
    + lib.concatMapStrings
      (name: assert' "retired exporter path ${name} is absent"
        (!(builtins.pathExists (marketplaceDir + "/${name}"))))
      [ "lib.nix" "hooks" "settings" "mcp" ];

  sharedChecks =
    let
      skill = builtins.readFile (marketplaceDir + "/plugins/ux-stories/skills/story-writer/SKILL.md");
      extension = builtins.readFile (marketplaceDir + "/plugins/ux-stories/pi/extension.ts");
      guardian = builtins.readFile (marketplaceDir + "/plugins/ux-stories/agents/story-guardian.md");
      devenvExtension = builtins.readFile (marketplaceDir + "/plugins/devenv-workflow/pi/extension.ts");
    in
    assert' "UX skill stays graphical-only" (lib.hasInfix "graphical, screen-based" skill)
    + assert' "UX skill excludes CLI work" (lib.hasInfix "CLI or terminal output" skill)
    + assert' "UX extension redirects non-graphical work"
      (lib.hasInfix "Use spec-driven command/output" extension)
    + assert' "shared guardian reference retains its scope gate"
      (lib.hasInfix "Scope gate" guardian)
    + assert' "Pi extension points durable guidance to shared markdown"
      (lib.hasInfix "### Shared troubleshooting knowledge" devenvExtension
      && lib.hasInfix "shared \\`devenv-project\\` skill and \\`/devenv-diagnose\\` command" devenvExtension)
    + assert' "Pi extension describes native ownership"
      (lib.hasInfix "### Pi resource ownership" devenvExtension
      && !(lib.hasInfix ".claude/" devenvExtension)
      && !(lib.hasInfix ".opencode/" devenvExtension));

  domainTreeChecks =
    let
      manifest = builtins.fromJSON
        (builtins.readFile (marketplaceDir + "/plugins/domain-tree/package.json"));
      lock = builtins.readFile (marketplaceDir + "/plugins/domain-tree/package-lock.json");
    in
    assert' "domain-tree has scoped npm identity"
      (manifest.name == "@behaghel/pi-domain-tree")
    + assert' "domain-tree loads TypeScript source"
      (manifest.pi.extensions == [ "./pi/extension.ts" ])
    + assert' "domain-tree retains its license" (manifest.license == "MPL-2.0")
    + assert' "YAML is a runtime dependency" (manifest.dependencies.yaml == "^2.9.1")
    + assert' "Pi-provided typebox is a peer" (manifest.peerDependencies.typebox == "*")
    + assert' "no generated domain-tree bundle"
      (!(builtins.pathExists (marketplaceDir + "/plugins/domain-tree/dist")))
    + assert' "lock omits esbuild platform binaries"
      (!(lib.hasInfix "node_modules/@esbuild/" lock));

  templateNames = builtins.attrNames (lib.filterAttrs (_: type: type == "directory")
    (builtins.readDir ../templates));
  templateChecks = lib.concatMapStrings
    (name:
      let
        base = ../templates + "/${name}";
        source = builtins.readFile (base + "/devenv.nix");
        yaml = builtins.readFile (base + "/devenv.yaml");
      in
      assert' "${name}: retains managed sessions"
        (lib.hasInfix "agentSession.enable = true;" source
        && lib.hasInfix "/modules/flake/agent-session" yaml)
      + assert' "${name}: no retired client generation"
        (!(lib.hasInfix "claude.code" source)
        && !(lib.hasInfix "opencode" source)
        && !(lib.hasInfix "marketplace/lib.nix" source)))
    templateNames;

  piExtensionPaths = lib.concatMap
    (name:
      let
        base = marketplaceDir + "/plugins/${name}";
        manifest = builtins.fromJSON (builtins.readFile (base + "/package.json"));
      in
      map (resource: base + "/${resource}") manifest.pi.extensions)
    pluginNames;
  piSyntaxCheck = pkgs.runCommand "marketplace-pi-extension-syntax"
    { nativeBuildInputs = [ pkgs.nodejs ]; } ''
    set -euo pipefail
    ${lib.concatMapStringsSep "\n" (path: ''
      node --check ${lib.escapeShellArg (toString path)}
    '') piExtensionPaths}
    node ${lib.escapeShellArg (toString ./spec-driven-modes.test.mjs)}
    node ${lib.escapeShellArg (toString ./agent-session-skill.test.mjs)} ${lib.escapeShellArg (toString ../.)}
    echo ok > "$out"
  '';

  domainTreeBehaviorCheck = pkgs.buildNpmPackage {
    pname = "domain-tree-behavior-check";
    version = "0.4.0";
    src = marketplaceDir + "/plugins/domain-tree";
    npmDeps = pkgs.importNpmLock {
      npmRoot = marketplaceDir + "/plugins/domain-tree";
    };
    npmConfigHook = pkgs.importNpmLock.npmConfigHook;
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      node test/domain-core.test.mjs
      npm pack --dry-run --json > pack.json
      node --input-type=module <<'NODE'
      import { readFileSync } from "node:fs";
      const [pack] = JSON.parse(readFileSync("pack.json", "utf8"));
      const files = new Set(pack.files.map((entry) => entry.path));
      for (const required of [
        "LICENSE", "pi/extension.ts", "pi/domain-core.ts",
        "skills/domain-navigator/SKILL.md",
      ]) {
        if (!files.has(required)) throw new Error("npm package omits " + required);
      }
      NODE
      echo ok > "$out"
      runHook postInstall
    '';
  };
in
pkgs.runCommand "marketplace-tests" { } ''
  cat <<'RESULTS'
  Native Pi catalogue:
  ${catalogueChecks}
  Shared workflow content:
  ${sharedChecks}
  Published package contract:
  ${domainTreeChecks}
  Template ownership:
  ${templateChecks}
  RESULTS
  test -f ${piSyntaxCheck}
  test -f ${domainTreeBehaviorCheck}
  echo "All Pi marketplace checks passed."
  echo ok > "$out"
''
