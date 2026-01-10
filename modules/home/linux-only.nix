{ pkgs, lib, config, ... }:
let
  cfg = config.hub.linux;
  ghosttyPkg = pkgs.ghostty;
  ghosttyAvailable = !(ghosttyPkg.meta.broken or false);
  linuxPackages = with pkgs; [
    wl-clipboard
    xclip
    gpick
    gromit-mpx
  ];
in
{
  options.hub.linux.graphicalTools.enable = lib.mkOption {
    type = lib.types.bool;
    default = pkgs.stdenv.isLinux;
    description = "Install Linux-only graphical helpers (clipboard, screen annotations, terminal).";
  };

  config = {
    home.packages =
      (lib.optionals (pkgs.stdenv.isLinux && cfg.graphicalTools.enable) linuxPackages)
      ++ (lib.optionals (pkgs.stdenv.isLinux && cfg.graphicalTools.enable && ghosttyAvailable) [ ghosttyPkg ]);

    home.file.".config/gromit-mpx.cfg" = lib.mkIf (pkgs.stdenv.isLinux && cfg.graphicalTools.enable) {
      text = ''
        "red Pen" = PEN (size=7 color="red");
        "blue Pen" = "red Pen" (color="blue");
        "green Arrow" = LINE (size=7 color="limegreen" arrowsize=2);
        "yellow Pen" = "red Pen" (color="yellow");
        "yellow Marker" = RECOLOR (color = "yellow");
        "Eraser" = ERASER (size = 75);
        "red Rectangle" = RECT (color = "red");
        "smooth Arrow" = SMOOTH (size=7 color="cyan" arrowsize=2);
        "Virtual core pointer" = "red Pen";
        "Virtual core pointer"[SHIFT] = "yellow Marker";
        "Virtual core pointer"[CONTROL] = "green Arrow";
        "Virtual core pointer"[2] = "red Rectangle";
        "Virtual core pointer"[Button3] = "Eraser";
        "Virtual core pointer"[4] = "smooth Arrow";
      '';
    };
  };
}
