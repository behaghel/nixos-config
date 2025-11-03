
{ lib, pkgs, config, ... }:

let
  passwordStoreDir = "$HOME/.password-store";
  repoUrl = "git@gitlab.com:behaghel/pass.git";
  gitBin = "${pkgs.git}/bin/git";
  sshCommand = "${pkgs.openssh}/bin/ssh -F /dev/null";
  gpgPackage = config.programs.gpg.package;
  gpgBinary = "${gpgPackage}/bin/gpg";
  passPackage =
    pkgs.pass.overrideAttrs (old: {
      postInstall =
        (old.postInstall or "")
        + ''
          substituteInPlace "$out/bin/pass" \
            --replace 'GPG="gpg"' 'GPG="${gpgBinary}"' \
            --replace 'which gpg2 &>/dev/null && GPG="gpg2"' '# gpg2 check disabled'
        '';
      doInstallCheck = false;
    });
in
{
  programs.password-store = {
    enable = true;
    package = passPackage;
    settings = {
      PASSWORD_STORE_DIR = passwordStoreDir;
    };
  };

  home.activation.ensurePasswordStore = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ ! -d "${passwordStoreDir}/.git" ]; then
      rm -rf "${passwordStoreDir}"
      GIT_SSH_COMMAND="${sshCommand}" ${gitBin} clone "${repoUrl}" "${passwordStoreDir}"
    fi
  '';
}
