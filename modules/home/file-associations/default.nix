{ config, lib, pkgs, ... }:
let
  cfg = config.hub.fileAssociations;
  associationType = lib.types.submodule {
    options = {
      darwin = {
        enable = lib.mkOption { type = lib.types.bool; default = true; description = "Manage this association on macOS."; };
        contentType = lib.mkOption { type = lib.types.str; description = "macOS Uniform Type Identifier."; };
        application = lib.mkOption { type = lib.types.str; description = "Path to the macOS .app bundle."; };
        extension = lib.mkOption { type = lib.types.str; description = "Representative filename extension for checking Finder's effective opener."; };
      };
      linux = {
        mimeType = lib.mkOption { type = lib.types.str; description = "XDG MIME type."; };
        desktopFile = lib.mkOption { type = lib.types.str; description = "Desktop entry ID (including .desktop)."; };
      };
    };
  };
  darwinAssociations = builtins.filter (association: association.darwin.enable) (lib.attrValues cfg);
  # AppKit's default-application setter is asynchronous and can require user consent.
  setDefaultApp = pkgs.stdenv.mkDerivation {
    pname = "set-default-file-association";
    version = "1";
    src = ./set-default-app.m;
    dontUnpack = true;
    buildPhase = ''
      runHook preBuild
      $CC -x objective-c -fblocks -framework AppKit -framework UniformTypeIdentifiers "$src" -o set-default-file-association
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/bin"
      cp set-default-file-association "$out/bin/"
      runHook postInstall
    '';
  };
in
{
  options.hub.fileAssociations = lib.mkOption {
    type = lib.types.attrsOf associationType;
    default = { };
    description = "Preferred applications for named file types on macOS and Linux.";
  };

  config = lib.mkMerge [
    (lib.mkIf pkgs.stdenv.isDarwin {
      # copyApps must install the real bundle before Launch Services sees it.
      home.activation.setDefaultFileAssociations = lib.hm.dag.entryAfter [ "copyApps" ] ''
        # The helper checks the actual opener first; a no-op request still
        # triggers a macOS confirmation dialog. Respect Home Manager dry runs.
        ${lib.concatMapStringsSep "\n" (association: ''
          run /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
            -f ${lib.escapeShellArg association.darwin.application}
          run ${setDefaultApp}/bin/set-default-file-association \
            ${lib.escapeShellArg association.darwin.contentType} \
            ${lib.escapeShellArg association.darwin.application} \
            ${lib.escapeShellArg association.darwin.extension}
        '') darwinAssociations}
      '';
    })
    (lib.mkIf pkgs.stdenv.isLinux {
      xdg.mimeApps.enable = true;
      xdg.mimeApps.defaultApplications = lib.listToAttrs (map
        (association: lib.nameValuePair association.linux.mimeType [ association.linux.desktopFile ])
        (lib.attrValues cfg));
    })
  ];
}
