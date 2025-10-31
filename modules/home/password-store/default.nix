
{ lib, pkgs, ... }:

let
  passwordStoreDir = "$HOME/.password-store";
  repoUrl = "git@gitlab.com:behaghel/pass.git";
in
{
  programs.password-store = {
    enable = true;
    settings = {
      PASSWORD_STORE_DIR = passwordStoreDir;
    };
  };

  home.activation.ensurePasswordStore = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ ! -d "${passwordStoreDir}/.git" ]; then
      rm -rf "${passwordStoreDir}"
      ${pkgs.git}/bin/git clone "${repoUrl}" "${passwordStoreDir}"
    else
      ${pkgs.git}/bin/git -C "${passwordStoreDir}" fetch --all --prune
    fi
  '';
}
