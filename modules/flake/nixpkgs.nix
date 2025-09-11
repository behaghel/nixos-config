{ inputs, flake-parts-lib, ... }: {
  options.perSystem = flake-parts-lib.mkPerSystemOption ({ system, ... }: {
    imports = [
      "${inputs.nixpkgs}/nixos/modules/misc/nixpkgs.nix"
    ];

    nixpkgs = {
      hostPlatform = system;
      # Use local overlays (includes emacs + isync OAuth/mech support) instead of only the emacs one
      overlays = (import ../../overlays/default.nix { inherit inputs; });
      config.allowUnfree = true;
    };
  });
}
