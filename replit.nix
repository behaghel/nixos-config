
{ pkgs ? import <nixpkgs> {} }: {
  deps = [
    pkgs.nixFlakes
    pkgs.git
    pkgs.alejandra
    pkgs.treefmt
    pkgs.direnv
    pkgs.nix-direnv
  ];
}
