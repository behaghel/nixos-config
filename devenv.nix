{ pkgs, lib, ... }:
let
  isLinux = pkgs.stdenv.isLinux;
  giTypelibPath = pkgs.lib.makeSearchPath "lib/girepository-1.0" (
    [
      pkgs.gtk3
      pkgs.gdk-pixbuf
      pkgs.pango
      pkgs.cairo
      pkgs.gobject-introspection
    ]
    ++ lib.optionals isLinux [ pkgs.libappindicator-gtk3 ]
  );
  giLibraryPath = pkgs.lib.makeLibraryPath (
    [
      pkgs.gtk3
      pkgs.gdk-pixbuf
      pkgs.pango
      pkgs.cairo
    ]
    ++ lib.optionals isLinux [ pkgs.libappindicator-gtk3 ]
  );
  trayDevPackages = with pkgs;
    [ python3Packages.pytest ]
    ++ lib.optionals isLinux [
      python3Packages.pystray
      python3Packages.pillow
      python3Packages.pygobject3
      gtk3
      gdk-pixbuf
      libappindicator-gtk3
      pango
      cairo
      gobject-introspection
    ];
in
{
  packages = with pkgs; [
    bats
    just
    nixd
  ] ++ trayDevPackages;

  scripts.mail-sync-tests.exec = ''
    ./tests/run-mail-sync-autocorrect-tests.sh "$@"
  '';
  scripts.mail-tray-e2e.exec = lib.strings.concatStringsSep "\n" [
    (if pkgs.stdenv.isLinux then "" else "echo 'mail-tray e2e is Linux-only'; exit 0")
    ''
      ./tests/run-mail-tray-e2e.sh "$@"
    ''
  ];
  scripts.mail-tray-tests.exec = lib.strings.concatStringsSep "\n" [
    (if pkgs.stdenv.isLinux then ""
     else "echo 'mail-tray tests are Linux-only (GTK/appindicator); skipping.'; exit 0")
    ''
      export MAIL_TRAY_GI_TYPELIB_PATH=${giTypelibPath}
      export GI_TYPELIB_PATH=${giTypelibPath}
      export LD_LIBRARY_PATH=${giLibraryPath}:$LD_LIBRARY_PATH
      export PYTHONPATH=modules/home/mail/tray-src:$PYTHONPATH
      pytest modules/home/mail/tray-src "$@"
    ''
  ];

  git-hooks = {
    hooks.mail-sync-tests = {
      enable = true;
      name = "Mail sync autocorrect";
      entry = "./tests/run-mail-sync-autocorrect-tests.sh";
      language = "system";
      pass_filenames = false;
    };
    hooks.mail-tray-e2e = {
      enable = pkgs.stdenv.isLinux;
      name = "Mail tray e2e";
      entry = "./tests/run-mail-tray-e2e.sh";
      language = "system";
      pass_filenames = false;
    };
  };
}
