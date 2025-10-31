
{ lib, pkgs, ... }:

let
  passwordStoreDir = "$HOME/.password-store";
  repoUrl = "git@gitlab.com:behaghel/pass.git";
  gitBin = "${pkgs.git}/bin/git";
  sshCommand = "${pkgs.openssh}/bin/ssh -F /dev/null";
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
      GIT_SSH_COMMAND="${sshCommand}" ${gitBin} clone "${repoUrl}" "${passwordStoreDir}"
    else
      GIT_SSH_COMMAND="${sshCommand}" ${gitBin} -C "${passwordStoreDir}" fetch --all --prune
    fi
  '';
}
