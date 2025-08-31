# https://github.com/hercules-ci/flake-parts/issues/74#issuecomment-1513708722
{ inputs, flake-parts-lib, ... }: {
  options.perSystem = flake-parts-lib.mkPerSystemOption ({ pkgs, system, ... }: {
    nixpkgs = {
     overlays = [
       inputs.emacs.overlays
     ];
    };
  });
}