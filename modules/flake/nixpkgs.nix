{ inputs, flake-parts-lib, ... }: {
  options.perSystem = flake-parts-lib.mkPerSystemOption ({ system, ... }: {
    imports = [
      "${inputs.nixpkgs}/nixos/modules/misc/nixpkgs.nix"
    ];

    nixpkgs = {
      hostPlatform = system;
      overlays = [
        inputs.emacs.overlays.default
      ];
      config.allowUnfree = true;
    };
  });
}