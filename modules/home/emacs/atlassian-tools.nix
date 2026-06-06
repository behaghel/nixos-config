{ pkgs, lib }:
let
  platformMatrix = {
    aarch64-darwin = {
      os = "darwin";
      arch = "arm64";
    };
    x86_64-darwin = {
      os = "darwin";
      arch = "amd64";
    };
    aarch64-linux = {
      os = "linux";
      arch = "arm64";
    };
    x86_64-linux = {
      os = "linux";
      arch = "amd64";
    };
  };

  mkAtlassianTool =
    { pname, version, description, hashes }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      platform =
        if builtins.hasAttr system platformMatrix && builtins.hasAttr system hashes then
          platformMatrix.${system} // { hash = hashes.${system}; }
        else
          throw "Unsupported system ${system} for ${pname}";

      tag = "${pname}-v${version}";
      archive = "${pname}_${version}_${platform.os}_${platform.arch}.tar.gz";
    in
    pkgs.stdenvNoCC.mkDerivation {
      inherit pname version;

      src = pkgs.fetchurl {
        url = "https://github.com/open-cli-collective/atlassian-cli/releases/download/${tag}/${archive}";
        hash = platform.hash;
      };

      sourceRoot = ".";
      dontConfigure = true;
      dontBuild = true;

      installPhase = ''
        runHook preInstall
        install -Dm755 ${pname} "$out/bin/${pname}"
        install -Dm644 tools/${pname}/LICENSE "$out/share/licenses/${pname}/LICENSE"
        install -Dm644 tools/${pname}/README.md "$out/share/doc/${pname}/README.md"
        runHook postInstall
      '';

      meta = {
        inherit description;
        homepage = "https://github.com/open-cli-collective/atlassian-cli";
        license = lib.licenses.mit;
        mainProgram = pname;
        platforms = lib.platforms.unix;
      };
    };
in
{
  cfl = mkAtlassianTool {
    pname = "cfl";
    version = "1.0.37";
    description = "Confluence Cloud CLI from the Open CLI Collective Atlassian toolkit";
    hashes = {
      x86_64-darwin = "sha256-EMI0ecZAjR5cR/NjFomxIZGpu19p97cgfC3rx4JMMDI=";
      aarch64-darwin = "sha256-YaYhTFHJhrg3Dtd6Md/FC2x6lTnPbHmy6NCaKxUnCgg=";
      x86_64-linux = "sha256-lvDt6CnJN5K+0Xz8yF7qaGVpzvQUxYtVXyG1HQaTwIQ=";
      aarch64-linux = "sha256-KjCKP+Qk4hlXyMll7gDfOBujDIKyOnrSrUau1F9XOWA=";
    };
  };
}
