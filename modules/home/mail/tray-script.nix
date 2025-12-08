{ pkgs, lib }:
let
  python = pkgs.python3;
  py = pkgs.python3Packages;
  pythonDir = "$out/lib/${python.sitePackages}";
  out = drv: lib.getOutput "out" drv;
  giTypelibPath = lib.makeSearchPath "lib/girepository-1.0" [
    (out pkgs.gtk3)
    (out pkgs.gdk-pixbuf)
    (out pkgs.libappindicator-gtk3)
    (out pkgs.pango)
    (out pkgs.cairo)
    (out pkgs.gobject-introspection)
    (out pkgs.libnotify)
  ];
  hostTypelibPath = "/usr/lib/x86_64-linux-gnu/girepository-1.0:/usr/lib/girepository-1.0";
  giLibraryPath = lib.makeLibraryPath [
    (out pkgs.gtk3)
    (out pkgs.gdk-pixbuf)
    (out pkgs.libappindicator-gtk3)
    (out pkgs.pango)
    (out pkgs.cairo)
    (out pkgs.libnotify)
  ];
  mailTrayPackage = py.buildPythonApplication {
    pname = "mail-tray";
    version = "0.1.10";
    format = "other";
    src = ./tray-src;
    buildInputs = [
      pkgs.gtk3
      pkgs.gdk-pixbuf
      pkgs.libappindicator-gtk3
      pkgs.gobject-introspection
      pkgs.pango
      pkgs.cairo
      pkgs.libnotify
    ];
    nativeBuildInputs = [ pkgs.makeWrapper ];
    propagatedBuildInputs = with py; [ pystray pillow pygobject3 ];
    doCheck = false;
    installPhase = ''
      runHook preInstall
      mkdir -p "${pythonDir}" "$out/bin"
      install -Dm644 mail_tray.py "${pythonDir}/mail_tray.py"
      install -Dm644 test_mail_tray.py "$out/share/mail-tray/tests/test_mail_tray.py"
      cat >"$out/bin/mail-tray" <<EOF
#!/bin/sh
exec ${python.interpreter} "${pythonDir}/mail_tray.py" "\$@"
EOF
      chmod +x "$out/bin/mail-tray"
      runHook postInstall
    '';
    preFixup = ''
      wrapProgram $out/bin/mail-tray \
        --set PYTHONPATH "${pythonDir}:$PYTHONPATH" \
        --set MAIL_TRAY_GI_TYPELIB_PATH "${giTypelibPath}:${hostTypelibPath}" \
        --set GI_TYPELIB_PATH "${giTypelibPath}:${hostTypelibPath}:$GI_TYPELIB_PATH" \
        --set LD_LIBRARY_PATH "${giLibraryPath}:$LD_LIBRARY_PATH" \
        --prefix XDG_DATA_DIRS : "${pkgs.gtk3}/share:${pkgs.gsettings-desktop-schemas}/share:$XDG_DATA_DIRS"
    '';
    passthru = {
      inherit giTypelibPath giLibraryPath hostTypelibPath;
    };
  };
in
mailTrayPackage
