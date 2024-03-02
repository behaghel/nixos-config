{lib, ...}:
{
  home.activation = {
    # macos doesn't support symlink for keyboard layouts
    copyBepoLayout = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                       $DRY_RUN_CMD cp ".dotfiles/macos/Library/Keyboard Layouts/bepo.keylayout" $HOME/Library/Keyboard\ Layouts
      '';
  };
}