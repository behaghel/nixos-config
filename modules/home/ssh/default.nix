{ lib, ... }:

let
  codebergEd25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIVIC02vnjFyL+I4RHfvIGNtOgJMe769VTF1VR4EB3ZB";
  codebergEcdsa   = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBL2pDxWr18SoiDJCGZ5LmxPygTlPu+cCKSkpqkvCyQzl5xmIMeKNdfdBpfbCGDPoZQghePzFZkKJNR/v9Win3Sc=";
in
{
  programs.ssh = {
    enable = true;
    # Silence HM deprecation warning and declare explicit defaults.
    enableDefaultConfig = false;
    matchBlocks = {
      "*" = {
        # Keep to the canonical known_hosts file for maximum compatibility.
        userKnownHostsFile = "~/.ssh/known_hosts";
      };
      # Migrate existing ~/.ssh/config override for GitHub via port 443
      "github.com" = {
        hostname = "ssh.github.com";
        port = 443;
      };
    };
  };

  # Preseed Codeberg host keys into ~/.ssh/known_hosts idempotently.
  # Using activation avoids the need for wildcard includes, which some
  # OpenSSH builds may not expand in UserKnownHostsFile.
  home.activation.preseedCodebergKnownHosts = ''
    set -euo pipefail
    sshdir="$HOME/.ssh"
    kh="$sshdir/known_hosts"
    mkdir -p "$sshdir"
    : > /dev/null
    touch "$kh"
    chmod 600 "$kh" || true
    add_if_missing() {
      local line="$1"
      if ! grep -Fqx -- "$line" "$kh"; then
        printf '%s\n' "$line" >> "$kh"
      fi
    }
    add_if_missing "codeberg.org ${codebergEd25519}"
    add_if_missing "codeberg.org ${codebergEcdsa}"
  '';
}
