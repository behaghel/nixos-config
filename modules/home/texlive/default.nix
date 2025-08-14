
{ ... }:

{
  programs.texlive = {
    enable = true;
    extraPackages = tpkgs: { inherit (tpkgs) scheme-basic wrapfig amsmath ulem hyperref capt-of xcolor dvisvgm dvipng metafont; };
  };
}
