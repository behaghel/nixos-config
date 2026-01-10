#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git -C "${BASH_SOURCE[0]%/*}/.." rev-parse --show-toplevel)"
config="${repo_root}/modules/nixos/utm-builder-image.nix"
out_dir="${repo_root}/artifacts/utm-builder"
out_link="${out_dir}/result"
builders_default="ssh-ng://root@builder-x86 x86_64-linux ${repo_root}/keys/utm-builder_ed25519 4 1 benchmark,big-parallel"
builders="${BUILDERS:-$builders_default}"
nixos_release="${NIXOS_RELEASE:-25.11}"

mkdir -p "${out_dir}"

echo "Building qcow2 builder image from ${config} …"
# nixos-generators names the format 'qcow' (which outputs a qcow2 disk).
# Build via a derivation so we don't need to execute a Linux binary locally,
# and pin nixpkgs to this repo (25.11) so the builder Nix matches the host.
expr=$(cat <<'EOF'
let
  repo = builtins.getFlake (toString ./.);
  pkgs = import repo.inputs.nixpkgs { system = "x86_64-linux"; };
  nixpkgsPath = pkgs.path;
  evalConfig = import (nixpkgsPath + "/nixos/lib/eval-config.nix");
  system = "x86_64-linux";
  config = evalConfig {
    inherit system pkgs;
    modules = [
      (nixpkgsPath + "/nixos/modules/virtualisation/disk-image.nix")
      ./modules/nixos/utm-builder-image.nix
      { image.format = "qcow2"; }
    ];
  };
in
  pkgs.lib.overrideDerivation config.config.system.build.image (_: { requiredSystemFeatures = []; })
EOF
)
NIXPKGS_ALLOW_UNSUPPORTED_SYSTEM=1 \
drv_path=$(
  nix eval --system x86_64-linux \
    --option builders "${builders}" \
    --impure \
    --raw --expr "(${expr}).drvPath"
)

echo "Realising ${drv_path} via remote builders (may retry on transient failures)…"
attempt=1
out_path=""
while [ $attempt -le 5 ]; do
  if out_path=$(NIXPKGS_ALLOW_UNSUPPORTED_SYSTEM=1 nix-store -r "${drv_path}" --option builders "${builders}" --max-jobs 1); then
    break
  fi
  echo "Attempt ${attempt} failed; retrying…"
  attempt=$((attempt + 1))
done

if [ -z "${out_path}" ]; then
  echo "Failed to realise ${drv_path} after ${attempt} attempts" >&2
  exit 1
fi

rm -f "${out_link}"
ln -s "${out_path}" "${out_link}"

qcow_name="${out_dir}/builder-x86_64-${nixos_release}.qcow2"
cp -f "${out_path}/nixos.qcow2" "${qcow_name}"
echo "QCOW2 image available at ${out_link} (store path) and copied to ${qcow_name}"
