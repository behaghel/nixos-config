
{ inputs, ... }: [
  inputs.emacs.overlay
  # Compatibility: add lib.throw if missing (some nixpkgs packages expect it)
  (final: prev: {
    lib = prev.lib // (if prev.lib ? throw then { } else { throw = builtins.throw; });
  })
  # Use upstream nixpkgs isync with XOAUTH2 wrapper
  (final: prev: {
    isync = prev.isync.override { withCyrusSaslXoauth2 = true; };
  })
]
