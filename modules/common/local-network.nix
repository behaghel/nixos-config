{ lib, pkgs, config, options, ... }:

let
  cfg = config.hub.localNetwork;
  markerStart = "# >>> nixos-config local-network >>>";
  markerEnd = "# <<< nixos-config local-network <<<";

  renderHostLine = ip: names: "${ip} ${lib.concatStringsSep " " names}";

  renderedEntries = lib.concatStringsSep "\n" (lib.mapAttrsToList renderHostLine cfg.entries);

  entriesFile = pkgs.writeText "local-network-hosts" renderedEntries;
in
{
  options.hub.localNetwork.entries = lib.mkOption {
    type = lib.types.attrsOf (lib.types.listOf lib.types.str);
    default = { };
    example = {
      "192.168.1.199" = [ "mele" ];
    };
    description = ''
      Static local-network host aliases keyed by IP address. These entries are
      exposed through the platform-appropriate host resolution mechanism so the
      same alias data can be reused across Darwin and non-Darwin hosts.
    '';
  };

  config = lib.mkMerge [
    (lib.optionalAttrs (lib.hasAttrByPath [ "networking" "hosts" ] options) {
      networking.hosts = cfg.entries;
    })

    (lib.mkIf pkgs.stdenv.isDarwin {
      system.activationScripts.localNetworkHosts.text = ''
        echo "merging local network host aliases into /etc/hosts..." >&2

        hosts_file=/etc/hosts
        tmp_clean=$(/usr/bin/mktemp -t local-network-hosts.clean)
        tmp_final=$(/usr/bin/mktemp -t local-network-hosts.final)

        cleanup() {
          /bin/rm -f "$tmp_clean" "$tmp_final"
        }
        trap cleanup EXIT

        if [ -f "$hosts_file" ]; then
          /usr/bin/awk -v start=${lib.escapeShellArg markerStart} -v end=${lib.escapeShellArg markerEnd} '
            $0 == start { skip = 1; next }
            $0 == end { skip = 0; next }
            skip != 1 { print }
          ' "$hosts_file" > "$tmp_clean"
        else
          : > "$tmp_clean"
        fi

        /bin/cp "$tmp_clean" "$tmp_final"

        if [ -s ${entriesFile} ]; then
          if [ -s "$tmp_final" ]; then
            printf '\n' >> "$tmp_final"
          fi
          printf '%s\n' ${lib.escapeShellArg markerStart} >> "$tmp_final"
          /bin/cat ${entriesFile} >> "$tmp_final"
          printf '\n%s\n' ${lib.escapeShellArg markerEnd} >> "$tmp_final"
        fi

        if [ ! -f "$hosts_file" ] || ! /usr/bin/cmp -s "$tmp_final" "$hosts_file"; then
          /bin/cp "$tmp_final" "$hosts_file"
          /bin/chmod 644 "$hosts_file"
        fi
      '';
    })
  ];
}
