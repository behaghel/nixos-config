#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: install-mele-hub.sh [--install] /dev/nvme0n1 [ROOT_SIZE_GiB] [DATA_SIZE_GiB] [SWAP_SIZE_GiB]

- Default sizes: ROOT=200GiB, DATA=256GiB, SWAP=8GiB on a 512GiB disk.
- WARNING: This will wipe the target disk. Double-check the device path.
- Optional --install: after partitioning/mounting, build and install .#mele-hub using local flake (expects flake in current dir or /root/nixos-config).
USAGE
}

install_after=false
if [[ ${1-} == "--install" ]]; then
  install_after=true
  shift
fi

disk=${1-}
root_size=${2-200}
data_size=${3-256}
swap_size=${4-8}

repo_target=${REPO_TARGET:-/root/nixos-config}
repo_origin=${GIT_ORIGIN:-git@github.com:behaghel/nixos-config.git}

if [[ -z "${disk}" || ! -b "${disk}" ]]; then
  echo "Error: specify a valid block device (e.g., /dev/nvme0n1 or /dev/sda)." >&2
  usage
  exit 1
fi

echo "About to repartition ${disk} with: root=${root_size}GiB, data=${data_size}GiB, swap=${swap_size}GiB"
read -r -p "Type 'YES' to continue: " confirm
if [[ "${confirm}" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi

partprefix="${disk}"
if [[ "${disk}" == *nvme* || "${disk}" == *mmcblk* ]]; then
  partprefix="${disk}p"
fi

echo "Wiping partition table..."
sgdisk --zap-all "${disk}"

echo "Creating partitions (EFI, root, data, swap)..."
sgdisk -n1:1MiB:+512MiB -t1:EF00 -c1:EFI "${disk}"
sgdisk -n2:0:+${root_size}GiB -t2:8300 -c2:nixos "${disk}"
sgdisk -n3:0:+${data_size}GiB -t3:8300 -c3:syncthing "${disk}"
sgdisk -n4:0:+${swap_size}GiB -t4:8200 -c4:swap "${disk}"
partprobe "${disk}"

echo "Formatting..."
mkfs.fat -F32 -n EFI "${partprefix}1"
mkfs.ext4 -L nixos "${partprefix}2"
mkfs.ext4 -L syncthing "${partprefix}3"
mkswap -L swap "${partprefix}4"

echo "Mounting target..."
mount "${partprefix}2" /mnt
mkdir -p /mnt/boot /mnt/srv/syncthing
mount "${partprefix}1" /mnt/boot
mount "${partprefix}3" /mnt/srv/syncthing
swapon "${partprefix}4"

echo "Skipping repo clone; ensure ${repo_target} contains the flake before --install."

if $install_after; then
  echo "Building system closure (.#mele-hub) with emacs cachix substituter…"
  # Locate flake root: prefer CWD, then repo_target
  flake_root=${FLAKE_ROOT:-$(pwd)}
  if [[ ! -f "$flake_root/flake.nix" ]] && [[ -f "$repo_target/flake.nix" ]]; then
    flake_root="$repo_target"
  fi
  if [[ ! -f "$flake_root/flake.nix" ]]; then
    echo "Cannot find flake.nix. Run from the repo root or set FLAKE_ROOT." >&2
    exit 1
  fi

  pushd "$flake_root" >/dev/null
  emacs_cache="https://emacs.cachix.org"
  emacs_key="emacs.cachix.org-1:TU3ITeTVpL41RDdfJnr3CGqoTrs1sCWlpPhPkG2EW7E="
  system_path=$(nix build .#nixosConfigurations.mele-hub.config.system.build.toplevel \
    --no-link --print-out-paths \
    --option substituters "https://cache.nixos.org $emacs_cache" \
    --option trusted-public-keys "cache.nixos.org-1:WN+BsXkbQHd7US2PpL7aIs/cgCi2lvZFG5pPjC3Q6N8= $emacs_key")
  popd >/dev/null

  echo "Copying system closure to target…"
  nix copy --to /mnt "$system_path"

  echo "Installing using prebuilt system…"
  nixos-install --system "$system_path" --no-root-passwd
  echo "Install complete. You can now reboot without the USB key."
else
  echo "Partitioning and mounts ready. Next: run nixos-install --flake .#mele-hub"
fi
