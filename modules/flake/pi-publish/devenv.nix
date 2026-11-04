{ pkgs, lib, ... }:
let
  plugins = ../../../marketplace/plugins;
  publishable = lib.filterAttrs
    (name: type:
      type == "directory"
      && builtins.pathExists (plugins + "/${name}/package.json")
      && (
        let manifest = builtins.fromJSON (builtins.readFile (plugins + "/${name}/package.json"));
        in manifest ? pi && !(manifest.private or false)
      ))
    (builtins.readDir plugins);
in
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
  };

  scripts = lib.mapAttrs'
    (extension: _: lib.nameValuePair "pi:${extension}:publish" {
      description = "Interactively review and publish the ${extension} Pi package";
      exec = ''
        exec ${pkgs.python3}/bin/python3 "$DEVENV_ROOT/scripts/pi_publish.py" ${lib.escapeShellArg extension} "$@"
      '';
    })
    publishable;
}
