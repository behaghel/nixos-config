
{ inputs, lib, ... }:
{
  flake = 
    let
      # Function to list subdirectories and create templates
      findTemplates = baseDir:
        let
          dirContents = builtins.readDir baseDir;
          templateDirs = lib.filterAttrs (name: type: 
            type == "directory"
          ) dirContents;
        in
        lib.mapAttrs (name: _: {
          path = baseDir + "/${name}";
          description = 
            let
              readmePath = baseDir + "/${name}/README.md";
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
        }) templateDirs;

      # Template directories to scan
      templateConfigs = [
        { baseDir = "templates"; suffix = ""; }
        { baseDir = "templates-devenv"; suffix = "-devenv"; }
      ];

      # Scan all configured directories for templates
      allTemplates = lib.foldl' (acc: templateDef:
        let
          dir = templateDef.baseDir;
          suffix = templateDef.suffix;
          dirPath = inputs.self + "/${dir}";
        in
        if builtins.pathExists dirPath then
          acc // (lib.mapAttrs' (name: template: {
            name = name + suffix;
            value = template;
          }) (findTemplates dirPath))
        else
          acc
      ) {} templateConfigs;
    in
    {
      templates = allTemplates;
    };
}
