{ ... }:

{
  programs.alacritty = {
    enable = true;
    settings = {
      # Make Option (Alt/Meta) work on macOS: use Left Option as Alt
      # (Right Option is remapped to Control in our keyboard setup)
      window.option_as_alt = "OnlyLeft";
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
        # macOS: map Cmd+ctsr to send Meta-ctsr for tmux pane navigation
        {key = "C"; mods ="Command"; chars = "\x1bc";}
        {key = "T"; mods ="Command"; chars = "\x1bt";}
        {key = "S"; mods ="Command"; chars = "\x1bs";}
        {key = "R"; mods ="Command"; chars = "\x1br";}
        # Ensure Ctrl+Space arrives as NUL for zsh autosuggest acceptance
        {key = "Space"; mods ="Control"; chars = "\x00";}
      ];
      font = {
        size = 15; # 14 creates glitches on p10k prompt
        normal.family = "MesloLGS NF"; # p10k recommends
      };
    };
  };
}
