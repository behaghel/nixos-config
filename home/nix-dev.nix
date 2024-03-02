{pkgs, ...}:
{
  home.packages = with pkgs; [
    # Useful for Nix development
    nixci
    nix-health
    nil
    nixpkgs-fmt
    just
  ];
}
