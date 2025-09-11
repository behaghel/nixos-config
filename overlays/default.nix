
{ inputs, ... }: [
  inputs.emacs.overlay
  # Use upstream nixpkgs isync with XOAUTH2 wrapper
  (final: prev: {
    isync = prev.isync.override { withCyrusSaslXoauth2 = true; };
  })
  (final: prev: {
    nuenv = (inputs.nuenv.overlays.nuenv final prev).nuenv;
    omnix = inputs.omnix.packages.${final.system}.default;
  })
]
