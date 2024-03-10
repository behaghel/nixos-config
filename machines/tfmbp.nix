{pkgs, config, flake, lib, ...}:
{
  imports = [
    flake.inputs.self.darwinModules.default
    ../nixos/desktop/fonts.nix
  ];
  nixpkgs.hostPlatform = "aarch64-darwin";

  environment.systemPackages = [ pkgs.jdk19_headless ]; # for languagetools from Emacs

  # For home-manager to work.
  users.users.${flake.config.people.myself} = {
    name = flake.config.people.myself;
    home = "/Users/${flake.config.people.myself}";
  };

  home-manager.users.${flake.config.people.myself} = {
    hub = {
      git.enable = true;
      zsh.enable = true;
      # dropbox.enable = true;
      mail.enable = true;
      niv-apps.enable = true;
    };

    home.packages = with pkgs;
      [
        terminal-notifier
        coreutils

        glaxnimate
        #nivApps.Dropbox
        nivApps.Anki
        nivApps.VLC
        nivApps.Zotero
        nivApps.Kindle
      ];

    programs = {
      dircolors = {
        enable = true;
      };
      password-store = {
        enable = true;
        settings = {
          PASSWORD_STORE_DIR = "$HOME/.password-store";
        };
      };
      firefox = {
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
              # nur-no-pkgs = import flake.inputs.nur {
              #   nurpkgs = import flake.inputs.nixpkgs { system =  "aarch64-darwin"; };
              # };
              # extensions = with nur-no-pkgs.repos.rycee.firefox-addons; [
              #   ublock-origin
              #   browserpass
              #   org-capture
              #   pinboard
              #   vimium
              #   duckduckgo-privacy-essentials
              # ];
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
      browserpass = {
        enable = true;
        browsers = [ "firefox" ];
      };
      kitty = {
        enable = true; # see https://github.com/NixOS/nixpkgs/pull/137512
        settings = {
          font_size = (if pkgs.stdenv.isDarwin then 14 else 12);
          strip_trailing_spaces = "smart";
          enable_audio_bell = "no";
          term = "xterm-256color";
          macos_titlebar_color = "background";
          macos_option_as_alt = "left";
          scrollback_lines = 10000;
          scrollback_pager = "less +G -R";
        };
        font = {
          package = pkgs.jetbrains-mono;
          name = "JetBrains Mono";
        };
        keybindings = {
          "alt+space" = "_";
          "alt+y" = "{";
          "alt+x" = "}";
          "alt+è" = "`";
        };
        extraConfig = ''
        mouse_map left click ungrabbed mouse_handle_click selection link prompt
        mouse_map ctrl+left press ungrabbed,grabbed mouse_click_url
        '';
      };
      alacritty = {
        enable = true;
        settings = {
          # to make Option (alt) work on macOS
          window.option_as_alt = "OnlyRight";
          mouse.bindings = [{ mouse = "Middle"; action = "PasteSelection";}];
          # default config isn't bépo friendly: all AltGr shortcuts
          # need to be redeclared explicitly here.
          # alacritty --print-events to detect what to put below
          keyboard.bindings = [
            {key = "Space"; mods ="Alt"; chars = "_";}
            {key = "k"; mods ="Alt"; chars = "~";}
            {key = "b"; mods ="Alt"; chars = "|";}
            {key = "e"; mods ="Alt"; chars = "&";}
            {key = "y"; mods ="Alt"; chars = "{";}
            {key = "x"; mods ="Alt"; chars = "}";}
          ];
          font = {
            size = 15; # 14 creates glitches on p10k prompt
            normal.family = "MesloLGS NF"; # p10k recommends
          };
        };
      };
      texlive = {
        enable = true;
        extraPackages =  tpkgs: { inherit (tpkgs) scheme-basic wrapfig amsmath ulem hyperref capt-of xcolor dvisvgm dvipng metafont; };
      };

    };
    # Emacs
    programs.emacs = {
      enable = true;
      package = pkgs.emacs-unstable;
    };
  };
}
