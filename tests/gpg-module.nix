{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  evalCfg = expectSmartcard: diagnostics:
    (hm.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        ../modules/home/gpg.nix
        ../modules/home/darwin/yknotify
        {
          home.username = "tester";
          home.homeDirectory = "/tmp/tester";
          home.stateVersion = "24.11";
          hub.yknotify.diagnostics.enable = lib.mkIf diagnostics true;
          programs.gpg = {
            inherit expectSmartcard;
            useNixGPG = true;
          };
        }
      ];
    }).config;

  smartcardCfg = evalCfg true false;
  disabledCfg = evalCfg false false;
  diagnosticCfg = evalCfg true true;
  smartcardSettings = smartcardCfg.programs.gpg.scdaemonSettings;
  disabledSettings = disabledCfg.programs.gpg.scdaemonSettings;

  pcscCheck = assert' "smartcard mode uses PC/SC access"
    smartcardSettings."disable-ccid";

  driverCheck = assert' "PC/SC driver and sharing are explicit only when required"
    (if pkgs.stdenv.isDarwin then
      !builtins.hasAttr "pcsc-driver" smartcardSettings
      && !builtins.hasAttr "pcsc-shared" smartcardSettings
    else
      builtins.hasAttr "pcsc-driver" smartcardSettings
      && smartcardSettings."pcsc-shared");

  applicationCheck = assert' "Darwin avoids OpenPGP/PIV switching that clears card PIN state"
    (if pkgs.stdenv.isDarwin then
      smartcardSettings."disable-application" == "piv"
    else
      !builtins.hasAttr "disable-application" smartcardSettings);

  disabledCheck = assert' "disabled smartcard mode adds no scdaemon settings"
    (!builtins.hasAttr "disable-ccid" disabledSettings
      && !builtins.hasAttr "pcsc-shared" disabledSettings
      && !builtins.hasAttr "pcsc-driver" disabledSettings
      && !builtins.hasAttr "disable-application" disabledSettings);

  signingContextCheck = assert' "Git signing context is Darwin-only and follows smartcard enablement"
    (
      let
        path = [ "gpg" "openpgp" "program" ];
        enabled = smartcardCfg.programs.git.settings;
        disabled = disabledCfg.programs.git.settings;
      in
      (lib.hasAttrByPath path enabled == pkgs.stdenv.isDarwin)
      && !(lib.hasAttrByPath path disabled)
    );

  diagnosticCheck = assert' "diagnostics default off and opt-in changes the signer wrapper"
    (!smartcardCfg.hub.yknotify.diagnostics.enable
      && diagnosticCfg.hub.yknotify.diagnostics.enable
      && (if pkgs.stdenv.isDarwin then
      smartcardCfg.programs.git.settings.gpg.openpgp.program
        != diagnosticCfg.programs.git.settings.gpg.openpgp.program
    else true));

  agentLifecycleCheck = assert' "Darwin lets GnuPG start its agent on demand"
    (if pkgs.stdenv.isDarwin then
      !smartcardCfg.launchd.agents.gpg-agent.enable
    else
      true);
in
pkgs.runCommand "gpg-module-tests" { } ''
  cat <<'RESULTS'
  ── GPG Home Manager module ──
  ${pcscCheck}${driverCheck}${applicationCheck}${disabledCheck}${agentLifecycleCheck}${signingContextCheck}${diagnosticCheck}RESULTS
  echo "All GPG module tests passed."
  echo ok > $out
''
