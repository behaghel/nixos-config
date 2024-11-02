{ flake, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
  packages = self + /packages;
in
self: super: {
  nuenv = (inputs.nuenv.overlays.nuenv self super).nuenv;
  omnix = inputs.omnix.packages.${self.system}.default;
  emacs-unstable = inputs.emacs.packages.${self.system}.emacs-unstable;
}