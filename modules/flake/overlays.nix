# https://github.com/hercules-ci/flake-parts/issues/74#issuecomment-1513708722
{ flake-parts-lib, ... }: {
  options.perSystem = flake-parts-lib.mkPerSystemOption ({ pkgs, system, ... }: {
    nixpkgs = {
     overlays = [
       overlays.default
     ];
    };
  });
}