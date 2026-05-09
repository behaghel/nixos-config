{ lib, pkgs, config, ... }:

let
  cfg = config.hub.passLaunchers;

  mkExecLine = launcher:
    if launcher.lookupCommand != null then
      let
        quotedArgs = lib.concatStringsSep " " (map lib.escapeShellArg launcher.lookupArgs);
      in
      ''exec "$target"${lib.optionalString (quotedArgs != "") " ${quotedArgs}"} "$@"''
    else
      let
        quotedCommand = lib.concatStringsSep " " (map lib.escapeShellArg launcher.command);
      in
      ''exec ${quotedCommand} "$@"'';

  mkPassExports = launcher:
    lib.concatStringsSep "\n" (lib.mapAttrsToList
      (envVar: passEntry: ''
        if [ -z "''${${envVar}:-}" ]; then
          value="$(${pkgs.pass}/bin/pass show ${lib.escapeShellArg passEntry} | ${pkgs.coreutils}/bin/head -n1)"
          if [ -z "$value" ]; then
            echo "error: pass entry ${passEntry} is empty" >&2
            exit 1
          fi
          export ${envVar}="$value"
        fi
      '')
      launcher.passEnv);

  mkWrapperText = name: launcher: ''
    #!/usr/bin/env sh
    set -eu

    ${lib.optionalString (launcher.lookupCommand != null) ''
      self_path="$(${pkgs.coreutils}/bin/realpath "$0" 2>/dev/null || printf '%s' "$0")"
      target=""

      OLD_IFS=$IFS
      IFS=:
      for dir in $PATH; do
        candidate="$dir/${launcher.lookupCommand}"
        if [ -x "$candidate" ]; then
          candidate_path="$(${pkgs.coreutils}/bin/realpath "$candidate" 2>/dev/null || printf '%s' "$candidate")"
          if [ "$candidate_path" != "$self_path" ]; then
            target="$candidate"
            break
          fi
        fi
      done
      IFS=$OLD_IFS

      if [ -z "$target" ]; then
        ${lib.concatStringsSep "\n" (map (candidate: ''
          if [ -z "$target" ] && [ -x ${lib.escapeShellArg candidate} ]; then
            target=${lib.escapeShellArg candidate}
          fi
        '') launcher.fallbackCandidates)}
      fi

      if [ -z "$target" ]; then
        echo "error: could not locate the real ${launcher.lookupCommand} binary behind the ${name} wrapper" >&2
        exit 1
      fi
    ''}

    if [ "''${${launcher.bypassEnvVar}:-0}" = 1 ]; then
      ${mkExecLine launcher}
    fi

    ${mkPassExports launcher}

    ${mkExecLine launcher}
  '';

  wrappers = lib.filterAttrs (_: launcher: launcher.enable) cfg;
in
{
  options.hub.passLaunchers = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
      options = {
        enable = lib.mkEnableOption "pass-backed launcher";

        passEnv = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          description = "Environment variable to password-store entry mapping for this launcher.";
        };

        bypassEnvVar = lib.mkOption {
          type = lib.types.str;
          default = "HUB_PASS_LAUNCHERS_BYPASS";
          description = "If this environment variable is set to 1, skip all pass lookups and launch the wrapped command directly.";
        };

        lookupCommand = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Binary name to resolve in PATH and wrap.";
        };

        lookupArgs = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Static arguments appended before user arguments when wrapping an existing binary.";
        };

        fallbackCandidates = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Absolute fallback binary paths tried if lookupCommand is not found in PATH.";
        };

        command = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Exact command vector to execute when not wrapping an existing binary.";
        };
      };
    }));
    default = { };
    description = "Reusable pass-backed launchers that export env vars from password-store before executing a command.";
  };

  config = {
    assertions = lib.mapAttrsToList (name: launcher: {
      assertion = !launcher.enable || ((launcher.lookupCommand != null) != (launcher.command != [ ]));
      message = "hub.passLaunchers.${name}: choose exactly one of lookupCommand or command.";
    }) cfg;

    home.file = lib.mapAttrs'
      (name: launcher: lib.nameValuePair ".local/bin/${name}" {
        executable = true;
        text = mkWrapperText name launcher;
      })
      wrappers;
  };
}
