(self: super: {
  sketchybar = super.callPackage ./sketchybar { };
  attr = super.attr.overrideAttrs (o: {
    patches = (o.patches or [ ]) ++ [
      ./patches/basename-decl.patch
    ];
  });
})
