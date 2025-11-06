{ pkgs, lib, config, options, ... }:
let
  cfg = config.programs.gpg;
  expectSmartcard = cfg.expectSmartcard;
  useNixGPG = cfg.useNixGPG;

  yubikeyKey = ../../keys/5137D6FF80B95202-2025-11-02.asc;
  keyMetadata = pkgs.runCommand "yubikey-key-metadata"
    { buildInputs = [ pkgs.gnupg pkgs.gawk ]; }
    ''
      export GNUPGHOME="$TMPDIR/gnupg"
      mkdir -m 700 "$GNUPGHOME"
      info="$TMPDIR/info"
      ${pkgs.gnupg}/bin/gpg --with-colons --import-options show-only --import ${yubikeyKey} \
        | ${pkgs.gawk}/bin/awk -F: '
            /^pub:/ && key == "" { key = $5 }
            /^fpr:/ && fpr == "" { fpr = $10 }
            END {
              if (key == "" || fpr == "")
                exit 1
              printf "%s\n%s\n", key, fpr
            }
          ' > "$info"
      mv "$info" "$out"
    '';
  keyMetadataLines =
    lib.splitString "\n"
      (lib.removeSuffix "\n" (builtins.readFile keyMetadata));
  primaryKeyId =
    "0x" + lib.elemAt keyMetadataLines 0;
  primaryFingerprint =
    lib.elemAt keyMetadataLines 1;
  pinentryPackage =
    if pkgs.stdenv.isDarwin then pkgs.pinentry_mac else pkgs.pinentry-gtk2;
  useSystemGpg =
    !useNixGPG && pkgs.stdenv.isLinux && !builtins.pathExists "/etc/NIXOS";
  systemGpgWrapper =
    if useSystemGpg then
      let
        makeWrapper =
          name: target:
          pkgs.writeShellScriptBin name ''
            exec ${target} "$@"
          '';
      in
      pkgs.symlinkJoin {
        name = "system-gpg-wrapper";
        paths = [
          (makeWrapper "gpg" "/usr/bin/gpg")
          (makeWrapper "gpg-agent" "/usr/bin/gpg-agent")
          (makeWrapper "gpgconf" "/usr/bin/gpgconf")
          (makeWrapper "gpg-connect-agent" "/usr/bin/gpg-connect-agent")
          (makeWrapper "dirmngr" "/usr/bin/dirmngr")
          (makeWrapper "dirmngr-client" "/usr/bin/dirmngr-client")
        ] ++ lib.optional (builtins.pathExists "/usr/bin/gpgsm") (makeWrapper "gpgsm" "/usr/bin/gpgsm");
        meta = {
          mainProgram = "gpg";
        };
      }
    else
      pkgs.gnupg;
  gpgPackage = if useNixGPG then pkgs.gnupg else systemGpgWrapper;

  pcscliteLib = lib.getLib pkgs.pcsclite;
  systemPcscPath =
    if pkgs.stdenv.isx86_64 && pkgs.stdenv.isLinux then
      "/usr/lib/x86_64-linux-gnu/libpcsclite.so.1"
    else if pkgs.stdenv.isLinux then
      "/usr/lib/libpcsclite.so.1"
    else
      null;
  pcscLib =
    if !expectSmartcard then
      null
    else if useSystemGpg then
      systemPcscPath
    else if pkgs.stdenv.isLinux && !builtins.pathExists "/etc/NIXOS" then
      systemPcscPath
    else
      "${pcscliteLib}/lib/libpcsclite.so.1";
in
{
  options.programs.gpg.expectSmartcard = lib.mkOption {
    type = lib.types.bool;
    default = true;
    description = ''
      Whether smartcard-backed subkeys (e.g., YubiKey) are required.
      When disabled, smartcard-specific tweaks such as scdaemon configuration
      and background card checks are skipped.
    '';
  };
  options.programs.gpg.useNixGPG = lib.mkOption {
    type = lib.types.bool;
    default = (!pkgs.stdenv.isLinux) || builtins.pathExists "/etc/NIXOS";
    description = ''
      Use the GnuPG build provided by Nix instead of the host's system packages.
      On Ubuntu this pulls in a newer gpg/scdaemon/pinentry stack from nixpkgs;
      ensure the system packages are removed via `scripts/ubuntu-use-nix-gpg.sh`
      before enabling this option.
    '';
  };

  config = {
    home.packages =
      let
        base = [
          pinentryPackage
        ];
        smartcardDeps =
          lib.optionals expectSmartcard (
            [
              pkgs.yubikey-personalization
              pkgs.yubikey-manager
            ]
            ++ lib.optionals pkgs.stdenv.isLinux [
              pkgs.pcsclite
              pkgs.ccid
            ]
          );
        nixGpgDeps =
          [ pkgs.gnupg ] ++ smartcardDeps;
      in
      if useSystemGpg then
        base ++ smartcardDeps
      else
        base ++ nixGpgDeps;

    programs.gpg =
      let
        base = {
          enable = true;
          package = gpgPackage;
          settings = {
            "default-key" = primaryKeyId;
            "default-recipient-self" = true;
            "auto-key-locate" = "local";
            "keyserver" = "hkps://keys.openpgp.org";
            "throw-keyids" = true;
          };
          scdaemonSettings =
            lib.optionalAttrs (pcscLib != null) {
              "disable-ccid" = true;
              "pcsc-driver" = pcscLib;
              "pcsc-shared" = true;
            };
        };
        dirmngrCfg =
          lib.optionalAttrs (lib.hasAttrByPath [ "programs" "gpg" "dirmngr" ] options) {
            dirmngr.enable = lib.mkForce (!useSystemGpg);
          };
      in
      base // dirmngrCfg;

    services.gpg-agent = {
      enable = true;
      enableExtraSocket = true;
      grabKeyboardAndMouse = true;
      enableScDaemon = expectSmartcard;
      enableSshSupport = expectSmartcard;
      defaultCacheTtl = 43200;
      defaultCacheTtlSsh = 43200;
      maxCacheTtl = 86400;
      maxCacheTtlSsh = 86400;
      pinentry.package = pinentryPackage;
      enableZshIntegration = true;
      enableBashIntegration = true;
      enableFishIntegration = true;
      enableNushellIntegration = true;
      extraConfig = ''
        allow-loopback-pinentry
      '';
    };

    home.activation.importYubikeyPublicKey =
      let
        gpgBin = "${gpgPackage}/bin/gpg";
        escapedKey = lib.escapeShellArg yubikeyKey;
        ownertrustEntry = "${primaryFingerprint}:6:";
      in
      lib.hm.dag.entryAfter [ "linkGeneration" ] ''
        if ! ${gpgBin} --list-keys --with-colons ${primaryKeyId} >/dev/null 2>&1; then
          run ${gpgBin} --import ${escapedKey}
        fi
        if ! ${gpgBin} --export-ownertrust | grep -q '^${primaryFingerprint}:'; then
          printf '%s\n' '${ownertrustEntry}' | ${gpgBin} --import-ownertrust >/dev/null
        fi
      '';
  };
}
