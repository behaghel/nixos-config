{ pkgs }: {
  deps = [
    pkgs.nixVersions.latest
    pkgs.git
    pkgs.alejandra
    pkgs.treefmt
    pkgs.direnv
    pkgs.nix-direnv
  ];
}