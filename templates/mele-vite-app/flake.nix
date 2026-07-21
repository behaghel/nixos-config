{
  description = "example MeLE app image";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      revision = self.shortRev or self.dirtyShortRev or "unknown";
      buildTimestamp = self.lastModifiedDate or "unknown";

      sourceFilter = lib: path: _type:
        let
          rel = lib.removePrefix (toString ./. + "/") (toString path);
        in
        !(lib.hasPrefix ".git/" rel)
        && !(lib.hasPrefix ".devenv/" rel)
        && !(lib.hasPrefix ".direnv/" rel)
        && !(lib.hasPrefix "node_modules/" rel)
        && !(lib.hasPrefix "dist/" rel)
        && !(lib.hasPrefix "dist-server/" rel)
        && !(lib.hasPrefix "data/" rel)
        && !(lib.hasPrefix "coverage/" rel);

      makeApp = pkgs:
        pkgs.buildNpmPackage {
          pname = "example";
          version = "0.1.0";
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = sourceFilter pkgs.lib;
          };
          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          nativeBuildInputs = [ pkgs.esbuild ];
          npmBuildScript = "build";
          APP_BUILD_ID = revision;
          APP_COMMIT = revision;
          APP_BUILT_AT = buildTimestamp;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/example
            cp -R dist $out/share/example/dist
            cp dist-server/server.cjs $out/share/example/server.cjs
            runHook postInstall
          '';
        };

      makePackages = system:
        let
          pkgs = import nixpkgs { inherit system; };
          linuxPkgs = import nixpkgs { system = "x86_64-linux"; };
          app = makeApp pkgs;
          ociImage = pkgs.dockerTools.buildLayeredImage {
            name = "example";
            tag = "latest";
            architecture = "amd64";
            contents = [
              app
              linuxPkgs.cacert
              linuxPkgs.nodejs-slim_22
            ];
            config = {
              Cmd = [
                "${linuxPkgs.nodejs-slim_22}/bin/node"
                "${app}/share/example/server.cjs"
              ];
              Env = [
                "NODE_ENV=production"
                "PORT=8080"
                "APP_DATA_DIR=/data"
                "APP_STATIC_DIR=${app}/share/example/dist"
                "NIX_SSL_CERT_FILE=${linuxPkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
                "SSL_CERT_FILE=${linuxPkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              ];
              WorkingDir = "/";
              ExposedPorts = {
                "8080/tcp" = { };
              };
              Volumes = {
                "/data" = { };
              };
            };
          };
        in
        {
          default = app;
          ociImage = ociImage;
        };
    in
    {
      packages.aarch64-darwin = makePackages "aarch64-darwin";
      packages.x86_64-darwin = makePackages "x86_64-darwin";
      packages.x86_64-linux = makePackages "x86_64-linux";
    };
}
