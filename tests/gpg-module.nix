{ pkgs, lib, inputs }:

let
  hm = inputs.home-manager.lib;

  assert' = name: cond:
    if cond then "  ok  ${name}\n"
    else abort "FAIL ${name}";

  evalCfg = expectSmartcard: diagnostics: fido2:
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
          hub.yknotify.fido2.enable = lib.mkIf fido2 true;
          programs.gpg = {
            inherit expectSmartcard;
            useNixGPG = true;
          };
        }
      ];
    }).config;

  smartcardCfg = evalCfg true false false;
  disabledCfg = evalCfg false false false;
  diagnosticCfg = evalCfg true true false;
  fidoCfg = evalCfg true false true;
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

  fidoCheck = assert' "unreliable FIDO2 detection is off by default and explicitly opt-in"
    (!smartcardCfg.hub.yknotify.fido2.enable
      && fidoCfg.hub.yknotify.fido2.enable);

  agentLifecycleCheck = assert' "Darwin lets GnuPG start its agent on demand"
    (if pkgs.stdenv.isDarwin then
      !smartcardCfg.launchd.agents.gpg-agent.enable
    else
      true);
in
pkgs.runCommand "gpg-module-tests" { } ''
  cat <<'RESULTS'
  ── GPG Home Manager module ──
  ${pcscCheck}${driverCheck}${applicationCheck}${disabledCheck}${agentLifecycleCheck}${signingContextCheck}${diagnosticCheck}${fidoCheck}RESULTS
  ${lib.optionalString pkgs.stdenv.isDarwin ''
    # Exercise the rendered detector arguments, not just option defaults.
    grep -F -- '--predicate' ${builtins.head smartcardCfg.launchd.agents.yknotify.config.ProgramArguments}
    grep -F -- 'subsystem CONTAINS "CryptoTokenKit"' ${builtins.head smartcardCfg.launchd.agents.yknotify.config.ProgramArguments}
    grep -F -- '--predicate' ${builtins.head diagnosticCfg.launchd.agents.yknotify.config.ProgramArguments}
    if grep -F -- '--predicate' ${builtins.head fidoCfg.launchd.agents.yknotify.config.ProgramArguments}; then
      echo "FAIL FIDO2 opt-in must restore upstream HID detection"
      exit 1
    fi
  ''}
  echo "All GPG module tests passed."
  echo ok > $out
''
