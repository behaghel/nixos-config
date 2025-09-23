{
  programs.starship = {
    enable = true;
    settings = {
      # Prefer GCP context; hide AWS info to avoid stale region like eu-west-1
      aws = { disabled = true; };
      gcloud = {
        disabled = false;
        symbol = "☁️ ";
        # Keep format concise; starship uses $account and $project
        format = "on [$symbol$account@$project]($style) ";
      };
      username = {
        style_user = "blue bold";
        style_root = "red bold";
        format = "[$user]($style) ";
        disabled = false;
        show_always = true;
      };
      hostname = {
        ssh_only = false;
        ssh_symbol = "🌐 ";
        format = "on [$hostname](bold red) ";
        trim_at = ".local";
        disabled = false;
      };
    };
  };
}
