{ lib, pkgs, config, options, ... }:

let
  cfg = config.hub.localNetwork;

  renderHostLine = ip: names: "${ip} ${lib.concatStringsSep " " names}";

  renderedEntries = lib.concatStringsSep "\n" (lib.mapAttrsToList renderHostLine cfg.entries);

  darwinHostsText = ''
    127.0.0.1 localhost
    255.255.255.255 broadcasthost
    ::1 localhost
  '' + lib.optionalString (renderedEntries != "") ''

    ${renderedEntries}
  '';
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
      environment.etc."hosts".text = darwinHostsText;
    })
  ];
}
