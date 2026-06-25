{ pkgs }:

pkgs.texliveSmall.withPackages (ps: [
  ps.collection-latexrecommended
  ps.collection-fontsrecommended
  ps.pgf
  ps.pgfplots
  ps.geometry
  ps.hyperref
  ps.needspace
  ps.ulem
  ps.fontspec
  ps.wrapfig
  ps."capt-of"
  ps.tcolorbox
  ps.minted
  ps.fvextra
  ps.lettrine
])
