
{ inputs, ... }: {
  nixpkgs.overlays = [
    inputs.emacs.overlay
    (final: prev: {
      nuenv = (inputs.nuenv.overlays.nuenv final prev).nuenv;
      omnix = inputs.omnix.packages.${final.system}.default;
    })
  ];
}
