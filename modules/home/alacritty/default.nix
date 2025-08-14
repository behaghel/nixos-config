{ ... }:

{
  programs.alacritty = {
    enable = true;
    settings = {
      # to make Option (alt) work on macOS
      window.option_as_alt = "OnlyRight";
      mouse.bindings = [{ mouse = "Middle"; action = "PasteSelection";}];
      # default config isn't bépo friendly: all AltGr shortcuts
      # need to be redeclared explicitly here.
      # alacritty --print-events to detect what to put below
      keyboard.bindings = [
        {key = "Space"; mods ="Alt"; chars = "_";}
        {key = "k"; mods ="Alt"; chars = "~";}
        {key = "b"; mods ="Alt"; chars = "|";}
        {key = "e"; mods ="Alt"; chars = "&";}
        {key = "y"; mods ="Alt"; chars = "{";}
        {key = "x"; mods ="Alt"; chars = "}";}
      ];
      font = {
        size = 15; # 14 creates glitches on p10k prompt
        normal.family = "MesloLGS NF"; # p10k recommends
      };
    };
  };
}