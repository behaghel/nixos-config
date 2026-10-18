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
  imports = [
    ./modules/flake/agent-session/devenv.nix
    ./modules/openwrt/devenv.nix
  ];
  agentSession = {
    enable = true;
    agentCommand = [ "pi" ];
    # Keep local settings explicit; do not link credential stores or Pi state.
    localLinks = [
      ".envrc.local"
      "devenv.local.nix"
      "devenv.local.yaml"
      ".workon-assistant"
    ];
  };

  # Bun is only needed for the migrated regression suite, not everyday shells.
  profiles.agent-session-tests.module = { pkgs, lib, ... }: {
    packages = [ pkgs.bun pkgs.nodejs_24 pkgs.zsh pkgs.fish pkgs.python3 ];
    outputs.agent-session-tests = import ./tests/agent-session.nix { inherit pkgs lib; };
  };

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
  scripts."mele:activate".exec = ''
    nix run github:NixOS/nixpkgs/nixos-25.05#nixos-rebuild -- \
      switch \
      --fast \
      --flake .#mele-hub \
      --build-host hub@mele \
      --target-host hub@mele \
      --use-remote-sudo \
      "$@"
  '';

  scripts.mele-app.exec = ''
    ${pkgs.python3}/bin/python3 ./scripts/mele_app_cli.py "$@"
  '';


  scripts."mele:onboard-app".exec = ''
    ${pkgs.python3}/bin/python3 ./scripts/mele-app-onboard.py "$@"
  '';

  git-hooks = {
    hooks.mail-sync-tests = {
      enable = true;
      name = "Mail sync autocorrect";
      entry = "./tests/run-mail-sync-autocorrect-tests.sh";
      language = "system";
      pass_filenames = false;
      files = "(modules/home/mail/|tests/mail-sync|tests/run-mail-sync)";
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
