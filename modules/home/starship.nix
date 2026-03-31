{ ... }:
{
  programs.starship = {
    enable = true;
    settings = {
      add_newline = false;
      format = ''
        [╭](fg:#7aa2f7) $time $username@$hostname ''${custom.project} $nix_shell$fill$gcloud$python
        [╰](fg:#7aa2f7) $directory $git_branch $git_status$character
      '';
      right_format = "";

      fill = {
        symbol = " ";
      };

      aws = { disabled = true; };
      gcloud = {
        disabled = false;
        symbol = "☁ ";
        format = " [$symbol$project]($style)";
        style = "fg:#7dcfff";
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

      custom.project = {
        command = "printf '%s' \"$STARSHIP_PROJECT_LABEL\"";
        when = "[ -n \"$STARSHIP_PROJECT_LABEL\" ]";
        format = "[:$output:]($style)";
        style = "fg:#f7768e";
      };

      character = {
        success_symbol = "[❯](bold fg:#8aad4f)";
        error_symbol = "[❯](bold fg:#ed8796)";
      };

      python = {
        format = " [$virtualenv]($style)";
        style = "fg:#e0af68";
        symbol = "";
        pyenv_version_name = false;
        python_binary = "python";
      };

      nix_shell = {
        disabled = false;
        symbol = "❄ ";
        format = "[$symbol$state( $name)]($style)";
        pure_msg = "";
        impure_msg = "*";
        unknown_msg = "";
        style = "fg:#7aa2f7 bold";
      };
    };
  };
}
