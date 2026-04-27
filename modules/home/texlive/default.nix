
{ ... }:

{
  programs.texlive = {
    enable = true;
    extraPackages = tpkgs: {
      inherit (tpkgs)
        scheme-basic
        wrapfig
        amsmath
        ulem
        hyperref
        capt-of
        xcolor
        dvisvgm
        dvipng
        metafont
        # Minimum blockers / current prototype needs
        pgf
        tcolorbox
        listings
        titlesec
        enumitem
        # Strongly recommended extras
        caption
        float
        setspace
        ragged2e
        xurl
        fancyvrb
        fvextra
        upquote
        eso-pic
        background
        titling
        lastpage
        # Nice-to-have richer variants
        fontawesome5
        mdframed
        framed
        pgfplots
        ;
    };
  };
}
