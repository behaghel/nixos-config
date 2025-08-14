
{ pkgs, flake, ... }:

{
  programs.firefox = {
    enable = true;
    package = pkgs.nivApps.Firefox;
    profiles =
      let settings = {
            "app.update.auto" = true;
            # no top tabs => tabcenter on the side
            "browser.tabs.inTitlebar" = 0;
            # reopen windows and tabs on startup
            "browser.startup.page" = 3;
          };
          nur-no-pkgs = import flake.inputs.nur {
            nurpkgs = import flake.inputs.nixpkgs { system = "aarch64-darwin"; };
          };
          extensions = with nur-no-pkgs.repos.rycee.firefox-addons; [
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
