{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  evalCfg = expectSmartcard:
    (hm.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/gpg.nix
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
          programs.gpg = {
            inherit expectSmartcard;
            useNixGPG = true;
          };
        }
      ];
    }).config;

  smartcardSettings = (evalCfg true).programs.gpg.scdaemonSettings;
  disabledSettings = (evalCfg false).programs.gpg.scdaemonSettings;

  pcscCheck = assert' "smartcard mode uses PC/SC access"
    smartcardSettings."disable-ccid";

  driverCheck = assert' "PC/SC driver and sharing are explicit only when required"
    (if pkgs.stdenv.isDarwin then
      !builtins.hasAttr "pcsc-driver" smartcardSettings
      && !builtins.hasAttr "pcsc-shared" smartcardSettings
    else
      builtins.hasAttr "pcsc-driver" smartcardSettings
      && smartcardSettings."pcsc-shared");

  disabledCheck = assert' "disabled smartcard mode adds no scdaemon settings"
    (!builtins.hasAttr "disable-ccid" disabledSettings
      && !builtins.hasAttr "pcsc-shared" disabledSettings
      && !builtins.hasAttr "pcsc-driver" disabledSettings);
in
pkgs.runCommand "gpg-module-tests" { } ''
  cat <<'RESULTS'
  ── GPG Home Manager module ──
  ${pcscCheck}${driverCheck}${disabledCheck}RESULTS
  echo "All GPG module tests passed."
  echo ok > $out
''
