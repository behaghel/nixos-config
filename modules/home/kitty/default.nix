
{ pkgs, ... }:

{
  programs.kitty = {
    enable = true;
    settings = {
      font_size = (if pkgs.stdenv.isDarwin then 14 else 12);
      strip_trailing_spaces = "smart";
      enable_audio_bell = "no";
      term = "xterm-256color";
      macos_titlebar_color = "background";
      macos_option_as_alt = "left";
      scrollback_lines = 10000;
      scrollback_pager = "less +G -R";
    };
    font = {
      package = pkgs.jetbrains-mono;
      name = "JetBrains Mono";
    };
    keybindings = {
      "alt+space" = "_";
      "alt+y" = "{";
      "alt+x" = "}";
      "alt+è" = "`";
      # Send Meta-ctsr for tmux pane navigation when pressing Cmd on macOS
      # This preserves finger memory: Cmd+c/t/s/r -> M-c/t/s/r to tmux
      "cmd+c" = "send_text all \x1bc";
      "cmd+t" = "send_text all \x1bt";
      "cmd+s" = "send_text all \x1bs";
      "cmd+r" = "send_text all \x1br";
      # Optional: ensure Ctrl+Space reaches the shell as NUL (zsh '^ ')
      "ctrl+space" = "send_text all \x00";
    };
    extraConfig = ''
    mouse_map left click ungrabbed mouse_handle_click selection link prompt
    mouse_map ctrl+left press ungrabbed,grabbed mouse_click_url
    '';
  };
}
