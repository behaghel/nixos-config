{ pkgs, lib, inputs }:
let
  hm = inputs.home-manager.lib;
  linuxPkgs = import pkgs.path { system = "x86_64-linux"; };
  association = {
    darwin = {
      contentType = "net.daringfireball.markdown";
      application = "/Users/tester/Applications/Emacs.app";
      extension = "md";
    };
    linux = {
      mimeType = "text/markdown";
      desktopFile = "emacsclient.desktop";
    };
  };
  evaluate = targetPkgs: associationConfig: (hm.homeManagerConfiguration {
    pkgs = targetPkgs;
    modules = [
      ../modules/home/file-associations/default.nix
      {
        home.username = "tester";
        home.homeDirectory = "/Users/tester";
        home.stateVersion = "24.11";
        hub.fileAssociations.markdown = associationConfig;
      }
    ];
  }).config;
  linux = evaluate linuxPkgs (lib.recursiveUpdate association { darwin.enable = false; });
  darwin = evaluate pkgs association;
  darwinDisabled = evaluate pkgs (lib.recursiveUpdate association { darwin.enable = false; });
  linuxCheck = linux.xdg.mimeApps.enable
    && linux.xdg.mimeApps.defaultApplications."text/markdown" == [ "emacsclient.desktop" ];
  darwinCheck = !pkgs.stdenv.isDarwin || (
    let script = darwin.home.activation.setDefaultFileAssociations.data;
    in lib.hasInfix "set-default-file-association" script
      && lib.hasInfix "net.daringfireball.markdown" script
      && lib.hasInfix "Emacs.app" script
  );
  darwinDisabledCheck = !pkgs.stdenv.isDarwin ||
    !lib.hasInfix "set-default-file-association" darwinDisabled.home.activation.setDefaultFileAssociations.data;
in
assert lib.assertMsg darwinDisabledCheck "Disabled macOS associations should not invoke the helper";
assert lib.assertMsg linuxCheck "Markdown should default to emacsclient.desktop on Linux";
assert lib.assertMsg darwinCheck "Markdown should use the macOS association helper";
pkgs.runCommand "file-associations" { } "touch $out"
