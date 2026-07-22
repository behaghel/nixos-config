{ config, lib, pkgs, ... }:

let
  cfg = config.mele.app;
  shellQuote = value: "'" + builtins.replaceStrings [ "'" ] [ "'\\''" ] value + "'";
in
{
  options.mele.app = {
    enable = lib.mkEnableOption "MeLE app deployment helpers";

    name = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "hedonis";
      description = "MeLE app slot name.";
    };

    ociImage = lib.mkOption {
      type = lib.types.str;
      default = ".#ociImage";
      description = "Nix installable that builds the app OCI archive.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "hub@mele";
      description = "Default SSH target for the MeLE host.";
    };

    logLines = lib.mkOption {
      type = lib.types.int;
      default = 80;
      description = "Default number of lines shown by mele:logs.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.name != null && cfg.name != "";
        message = "mele.app.name must be set when mele.app.enable is true.";
      }
    ];

    packages = [
      pkgs.git
      pkgs.curl
    ];

    scripts."mele:deploy".exec = ''
      set -euo pipefail

      release="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
      branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo unknown)"
      dirty=false
      if ! git diff --quiet --ignore-submodules -- 2>/dev/null || ! git diff --cached --quiet --ignore-submodules -- 2>/dev/null; then
        dirty=true
        release="$release-dirty-$(date -u +%Y%m%d%H%M%S)"
      fi
      repo="$(git config --get remote.origin.url || true)"
      target="''${MELE_HOST:-${cfg.host}}"

      if [ -f secretspec.toml ]; then
        echo "Updating ${cfg.name} SecretSpec contract on $target"
        ssh "$target" "sudo mele-app update-secretspec ${cfg.name} -" < secretspec.toml
      fi

      echo "Building linux/amd64 OCI image locally and deploying ${cfg.name} release $release to $target"
      nix build --extra-experimental-features 'nix-command flakes' ${shellQuote cfg.ociImage}
      gzip -dc result | ssh "$target" \
        "sudo mele-app deploy ${cfg.name} --release '$release' --repo '$repo' --branch '$branch' --dirty '$dirty' -"
    '';

    scripts."mele:image".exec = ''
      nix build --extra-experimental-features 'nix-command flakes' ${shellQuote cfg.ociImage}
      echo "OCI archive: $(readlink result)"
    '';

    scripts."mele:status".exec = ''
      ssh "''${MELE_HOST:-${cfg.host}}" "mele-app status ${cfg.name}"
    '';

    scripts."mele:health".exec = ''
      ssh "''${MELE_HOST:-${cfg.host}}" "mele-app health ${cfg.name}"
    '';

    scripts."mele:logs".exec = ''
      ssh "''${MELE_HOST:-${cfg.host}}" "mele-app logs ${cfg.name} --lines ${toString cfg.logLines}"
    '';

    scripts."mele:releases".exec = ''
      target="''${MELE_HOST:-${cfg.host}}"
      command="mele-app releases ${cfg.name}"
      for arg do command="$command $(printf '%q' "$arg")"; done
      ssh "$target" "$command"
    '';

    scripts."mele:rollback".exec = ''
      target="''${MELE_HOST:-${cfg.host}}"
      command="sudo mele-app rollback ${cfg.name}"
      for arg do command="$command $(printf '%q' "$arg")"; done
      ssh "$target" "$command"
    '';

    scripts."mele:backup-status".exec = ''
      target="''${MELE_HOST:-${cfg.host}}"
      command="sudo mele-app backup-status ${cfg.name}"
      for arg do command="$command $(printf '%q' "$arg")"; done
      ssh "$target" "$command"
    '';

    scripts."mele:backup-now".exec = ''
      target="''${MELE_HOST:-${cfg.host}}"
      command="sudo mele-app backup-now ${cfg.name}"
      for arg do command="$command $(printf '%q' "$arg")"; done
      ssh "$target" "$command"
    '';

    scripts."mele:restore".exec = ''
      target="''${MELE_HOST:-${cfg.host}}"
      command="sudo mele-app restore ${cfg.name}"
      for arg do command="$command $(printf '%q' "$arg")"; done
      ssh "$target" "$command"
    '';
  };
}
