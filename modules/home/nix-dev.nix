{ pkgs, ...}:
{
  home.packages = with pkgs; [
    # Useful for Nix development
    cachix
    nixci
    nix-health
    nil
    nixpkgs-fmt
    just
    nix-info
  ];
}
