{ pkgs, ... }:
{
  programs.starship = {
    enable = true;
    enableZshIntegration = false;
    settings = {
      add_newline = false;
      command_timeout = 1000;
      scan_timeout = 30;
      format = ''
        [╭](fg:#7aa2f7) $time $username@$hostname ''${custom.workon_tags}$fill
        [╰](fg:#7aa2f7) $directory $git_branch $git_status''${custom.prompt_character}
      '';
      right_format = "";

      fill = {
        symbol = " ";
      };

      aws = { disabled = true; };
      gcloud = {
        disabled = true;
      };

      time = {
        disabled = false;
        format = "[\\[$time\\]]($style)";
        time_format = "%H:%M";
        style = "fg:#7dcfff";
      };

      username = {
        style_user = "fg:#c0caf5 bold";
        style_root = "fg:#f7768e bold";
        format = "[$user]($style)";
        disabled = false;
        show_always = true;
      };

      hostname = {
        ssh_only = false;
        ssh_symbol = "🌐 ";
        format = "[$hostname]($style)";
        trim_at = ".local";
        disabled = false;
        style = "fg:#c0caf5 bold";
      };

      directory = {
        format = "[$path]($style)";
        style = "fg:#89dceb bold";
        truncation_length = 3;
        truncation_symbol = ".../";
      };

      git_branch = {
        format = "[\\[$symbol$branch\\]]($style)";
        style = "fg:#bb9af7";
        symbol = " ";
      };

      git_status = {
        style = "fg:#ff9e64";
      };

      custom.workon_tags = {
        command = "printf '%s' \"$STARSHIP_WORKON_TAGS\"";
        when = "[ -n \"$STARSHIP_WORKON_TAGS\" ]";
        format = "[:$output:]($style)";
        style = "fg:#f7768e";
      };

      custom.prompt_character = {
        command = "if [ -n \"$STARSHIP_NIX_SHELL_ACTIVE\" ]; then printf '❄'; else printf '❯'; fi";
        when = "true";
        format = "[$output]($style) ";
        style = "bold fg:#7dcfff";
      };

      character = {
        disabled = true;
      };

      python = {
        disabled = true;
      };

      nix_shell = {
        disabled = true;
      };
    };
  };
}
