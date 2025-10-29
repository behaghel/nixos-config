
{ pkgs, flake, ... }:

let
  firefoxPackage =
    if pkgs.stdenv.isDarwin then pkgs.firefox-bin else pkgs.firefox;
  nurNoPkgs = import flake.inputs.nur {
    nurpkgs = import flake.inputs.nixpkgs { system = pkgs.stdenv.hostPlatform.system; };
  };
in
{
  programs.firefox = {
    enable = true;
    package = firefoxPackage;
    profiles =
      let settings = {
            "app.update.auto" = true;
            # no top tabs => tabcenter on the side
            "browser.tabs.inTitlebar" = 0;
            # reopen windows and tabs on startup
            "browser.startup.page" = 3;
          };
          extensions = with nurNoPkgs.repos.rycee.firefox-addons; [
            ublock-origin
            browserpass
            org-capture
            pinboard
            vimium
            duckduckgo-privacy-essentials
          ];
      in {
        home = {
          id = 0;
          inherit settings;
            # extensions;
        };
        work2 = {
          id = 1;
          settings = settings // {
            "extensions.activeThemeID" = "cheers-bold-colorway@mozilla.org";
          };
          # inherit extensions;
        };
      };
  };

  programs.browserpass = {
    enable = true;
    browsers = [ "firefox" "chrome" ];
  };
}
