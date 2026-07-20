{ config, lib, pkgs, ... }:

let
  cfg = config.hub.mele.staticSites;
  siteDir = ./static-sites;
  siteFiles = lib.optionalAttrs (builtins.pathExists siteDir)
    (lib.filterAttrs
      (name: type: type == "regular" && lib.hasSuffix ".nix" name)
      (builtins.readDir siteDir));
  fileSiteName = fileName: lib.removeSuffix ".nix" fileName;
  generatedSites = lib.mapAttrs'
    (fileName: _type:
      lib.nameValuePair (fileSiteName fileName) (import (siteDir + "/${fileName}")))
    siteFiles;
  siteType = lib.types.submodule ({ name, ... }: {
    options = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to serve this static site.";
      };

      domain = lib.mkOption {
        type = lib.types.str;
        default = "${name}.home.behaghel.org";
        description = "Hostname served by Caddy for this static site.";
      };

      root = lib.mkOption {
        type = lib.types.str;
        default = "/srv/static/${name}/current";
        description = "Static file root served by Caddy.";
      };

      baseDir = lib.mkOption {
        type = lib.types.str;
        default = "/srv/static/${name}";
        description = "Base deployment directory for this static site.";
      };

      placeholder.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to serve a temporary placeholder before first deploy.";
      };
    };
  });

  enabledSites = lib.filterAttrs (_: site: site.enable) cfg.sites;

  placeholderFile = name: site: pkgs.writeText "mele-static-${name}-placeholder.html" ''
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${site.domain}</title>
      </head>
      <body>
        <main>
          <h1>Soon here…</h1>
          <p>${site.domain}</p>
        </main>
      </body>
    </html>
  '';

  caddyVirtualHost = name: site: {
    extraConfig = ''
      encode zstd gzip
      root * ${site.baseDir}
      try_files /current{path} /current{path}/ ${lib.optionalString site.placeholder.enable "/placeholder/index.html"}
      file_server
    '';
  };
in
{
  options.hub.mele.staticSites = {
    enable = lib.mkEnableOption "static sites on MeLE";

    sites = lib.mkOption {
      type = lib.types.attrsOf siteType;
      default = { };
      description = "Static sites served directly by Caddy on MeLE.";
    };
  };

  config = lib.mkIf cfg.enable {
    hub.mele.staticSites.sites = generatedSites;

    services.caddy.virtualHosts = lib.mapAttrs'
      (name: site: lib.nameValuePair site.domain (caddyVirtualHost name site))
      enabledSites;

    systemd.tmpfiles.rules = lib.flatten (lib.mapAttrsToList
      (name: site: [
        "d ${site.baseDir} 2775 root wheel -"
        "d ${site.baseDir}/releases 2775 root wheel -"
      ] ++ lib.optionals site.placeholder.enable [
        "d ${site.baseDir}/placeholder 2775 root wheel -"
        "L+ ${site.baseDir}/placeholder/index.html - - - - ${placeholderFile name site}"
      ])
      enabledSites);
  };
}
