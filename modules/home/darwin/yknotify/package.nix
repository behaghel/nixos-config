{ lib, buildGoModule, fetchFromGitHub }:

buildGoModule rec {
  pname = "yknotify";
  version = "0-unstable-2025-02-12";

  src = fetchFromGitHub {
    owner = "noperator";
    repo = "yknotify";
    rev = "0c773bdadedb137d02d95c79430fa5e0442c9950";
    hash = "sha256-AhTr3lzYS6z1XoqVC2IIdJoDVdWajrbGhOe20dVQrGQ=";
  };

  vendorHash = null; # zero external Go dependencies

  meta = with lib; {
    description = "Notify when YubiKey needs touch on macOS";
    homepage = "https://github.com/noperator/yknotify";
    license = licenses.unfree; # upstream has no LICENSE file
    platforms = platforms.darwin;
    mainProgram = "yknotify";
  };
}
