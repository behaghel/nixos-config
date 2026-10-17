{ pkgs }:
let
  writer = pkgs.stdenv.mkDerivation {
    pname = "pass-keychain-write";
    version = "1";
    src = ./keychain-write.m;
    dontUnpack = true;
    buildPhase = ''
      runHook preBuild
      $CC -x objective-c -fobjc-arc -framework Foundation -framework Security \
        "$src" -o pass-keychain-write
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/bin"
      install -m755 pass-keychain-write "$out/bin/pass-keychain-write"
      runHook postInstall
    '';
  };
  writerBin =
    if pkgs.stdenv.isDarwin then "${writer}/bin/pass-keychain-write"
    else "pass-keychain-write";
in
pkgs.writeShellApplication {
  name = "pass-keychain";
  runtimeInputs = [ pkgs.python3 pkgs.pass ];
  text = ''
    set -euo pipefail
    export PASS_KEYCHAIN_WRITER_BIN="''${PASS_KEYCHAIN_WRITER_BIN:-${writerBin}}"
    exec ${pkgs.python3}/bin/python3 ${./promote.py} "$@"
  '';
}
