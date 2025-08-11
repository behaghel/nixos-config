
{ inputs, lib, flake-parts-lib, ... }:
let
  inherit (flake-parts-lib) mkPerSystemOption;
  inherit (lib) mkOption types;
in
{
  options = {
    flake = {
      templateDirectories = mkOption {
        type = types.listOf types.str;
        default = [ "templates" "templates-devenv" ];
        description = "List of directories to scan for templates";
      };
    };
  };

  config = {
    flake = 
      let
        # Function to recursively find all template directories
        findTemplates = baseDir:
          let
            dirContents = builtins.readDir baseDir;
            templateDirs = lib.filterAttrs (name: type: 
              type == "directory" && 
              builtins.pathExists (baseDir + "/${name}/flake.nix")
            ) dirContents;
          in
          lib.mapAttrs' (name: _: {
            name = name;
            value = {
              path = baseDir + "/${name}";
              description = 
                let
                  readmePath = baseDir + "/${name}/README.md";
                  flakeNixPath = baseDir + "/${name}/flake.nix";
                in
                if builtins.pathExists readmePath then
                  # Try to extract description from README.md first line
                  let
                    readmeContent = builtins.readFile readmePath;
                    lines = lib.splitString "\n" readmeContent;
                    firstLine = if lines != [] then builtins.head lines else "";
                  in
                  if lib.hasPrefix "# " firstLine then
                    lib.removePrefix "# " firstLine
                  else
                    "Template: ${name}"
                else
                  "Template: ${name}";
            };
          }) templateDirs;

        # Scan all configured directories for templates
        allTemplates = lib.foldl' (acc: dir:
          let
            dirPath = ./. + "/../.." + "/${dir}";
          in
          if builtins.pathExists dirPath then
            acc // (findTemplates dirPath)
          else
            acc
        ) {} inputs.self.templateDirectories;
      in
      {
        templates = allTemplates;
      };
  };
}
