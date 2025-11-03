{ pkgs, lib, ... }:
let
  yubikeyKey = ../../keys/5137D6FF80B95202-2025-11-02.asc;
  primaryKeyId = "0x5137D6FF80B95202";
  pinentryPackage =
    if pkgs.stdenv.isDarwin then pkgs.pinentry_mac else pkgs.pinentry-gtk2;
  pinentryBinary =
    if pkgs.stdenv.isDarwin
    then "${pinentryPackage}/bin/pinentry-mac"
    else "${pinentryPackage}/bin/pinentry";
in
{
  home.packages =
    with pkgs;
    [
      gnupg
      pinentryPackage
      paperkey
      yubikey-personalization
      yubikey-manager
    ]
    ++ lib.optionals pkgs.stdenv.isLinux [
      pcsclite
      ccid
    ];

  programs.gpg = {
    enable = true;
    publicKeys = [
      {
        source = yubikeyKey;
        trust = "ultimate";
      }
    ];
    extraConfig = ''
      personal-cipher-preferences AES256 AES192 AES
      personal-digest-preferences SHA512 SHA384 SHA256
      personal-compress-preferences ZLIB BZIP2 ZIP Uncompressed
      default-preference-list SHA512 SHA384 SHA256 AES256 AES192 AES ZLIB BZIP2 ZIP Uncompressed
      cert-digest-algo SHA512
      s2k-digest-algo SHA512
      s2k-cipher-algo AES256
      charset utf-8
      no-comments
      no-emit-version
      no-greeting
      keyid-format 0xlong
      list-options show-uid-validity
      verify-options show-uid-validity
      with-fingerprint
      require-cross-certification
      require-secmem
      no-symkey-cache
      armor
      default-key ${primaryKeyId}
      default-recipient-self
      auto-key-locate local
      keyserver hkps://keys.openpgp.org
      throw-keyids
    '';
  };

  services.gpg-agent = {
    enable = true;
    enableSshSupport = true;
    enableExtraSocket = true;
    grabKeyboardAndMouse = true;
    enableScDaemon = true;
    defaultCacheTtl = 900;
    defaultCacheTtlSsh = 900;
    maxCacheTtl = 3600;
    maxCacheTtlSsh = 3600;
    pinentry.package = pinentryPackage;
    extraConfig = lib.mkAfter ''
      enable-ssh-support
      allow-loopback-pinentry
      use-standard-socket
      pinentry-program ${pinentryBinary}
    '';
  };
}
