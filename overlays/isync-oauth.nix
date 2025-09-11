final: prev: {
  isync = prev.isync.overrideAttrs (old: {
    buildInputs = (old.buildInputs or []) ++ [ prev.gsasl ];
    configureFlags = (old.configureFlags or []) ++ [ "--with-sasl=gsasl" ];
  });
}
