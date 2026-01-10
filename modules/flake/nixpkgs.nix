{ inputs, flake-parts-lib, ... }:
let
  lib = inputs.nixpkgs.lib;
in
{
  options.perSystem = flake-parts-lib.mkPerSystemOption ({ system, ... }: {
    imports = [
      "${inputs.nixpkgs}/nixos/modules/misc/nixpkgs.nix"
    ];

    nixpkgs =
      let
        isDarwin = lib.hasInfix "darwin" system;
        hostPlatform =
          if isDarwin then {
            system = system;
            # Match upstream nixpkgs-25.11-darwin (Hydra builds use 14.4).
            darwinSdkVersion = "14.4";
          } else system;
      in {
        inherit hostPlatform;
        # Use local overlays (includes emacs + isync OAuth/mech support) instead of only the emacs one
        overlays = (import ../../overlays/default.nix { inherit inputs; });
        config = {
          allowUnfree = true;
          # Keep SDK aligned with upstream cache to avoid rebuilding stdenv.
          darwin.apple_sdk.sdkVersion = lib.mkIf isDarwin "14.4";
          darwin.apple_sdk.version = lib.mkIf isDarwin "14.4";
        };
      };
  });
}
