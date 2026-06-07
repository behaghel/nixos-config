# Configuration for my M1 Macbook Max (using nix-darwin)
{ flake, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
  ];

  nixpkgs.hostPlatform = "aarch64-darwin";
  nixpkgs.config.allowUnfree = true;
  networking.hostName = "tfmbp";

  system.primaryUser = "hub";

  myusers = [ "hub" ];

  # No Touch ID override for sudo; fall back to default PAM stack.
}
