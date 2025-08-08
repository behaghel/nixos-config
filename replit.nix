{ pkgs }: {
  deps = [
    pkgs.nixVersions.stable
    pkgs.git
    pkgs.alejandra
    pkgs.treefmt
    pkgs.direnv
    pkgs.nix-direnv
  ];
}