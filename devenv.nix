{ pkgs, ... }:
{
  packages = with pkgs; [
    bats
    just
    nixd
  ];

  scripts.mail-sync-tests.exec = ''
    ./tests/run-mail-sync-autocorrect-tests.sh "$@"
  '';

  git-hooks = {
    hooks.mail-sync-tests = {
      enable = true;
      name = "Mail sync autocorrect";
      entry = "./tests/run-mail-sync-autocorrect-tests.sh";
      language = "system";
      pass_filenames = false;
    };
  };
}
