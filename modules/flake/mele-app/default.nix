# This directory is imported by external devenv projects via devenv.yaml:
#
#   imports:
#     - nixos-config/modules/flake/mele-app
#
# nixos-unified also discovers directories under modules/flake and expects a
# default.nix. Keep this flake module intentionally empty; the devenv module is
# in ./devenv.nix.
{ ... }:
{ }
