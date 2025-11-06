{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
  isLinux = pkgs.stdenv.isLinux;
in
{
  imports =
    [
      self.homeModules.default
      self.homeModules.dev
      self.homeModules.browserpass
      self.homeModules.emacs
      self.homeModules.password-store
      self.homeModules."video-editing"
      self.homeModules.dropbox
      self.homeModules.linux-only
      self.homeModules.darwin-only
    ];
  services.local-modules.nix-darwin.keyboard.bepo.enable = true;
  programs.gpg.useNixGPG = true;

  # Defined by /modules/home/me.nix
  # And used all around in /modules/home/*
  me = {
    username = "hubertbehaghel";
    fullname = "Hubert Behaghel";
    email = "hubert.behaghel@veriff.net";
  };

  home.packages = with pkgs; [
    gemini-cli
    claude-code
    codex
  ];

  hub.mail = {
    enable = true;
  } // lib.optionalAttrs isLinux {
    imapnotify = {
      enable = true;
      accounts = [ "work" ];
      notify = true;
    };
  };

  hub.dropbox = lib.mkIf isLinux {
    enable = true;
  };

  hub.videoEditing = {
    enable = true;
    fillerWords = [ "uh" "um" "and you know" "and so" "and so for us" "so for us" "you know" "kind of" "a bit" "a bit of" "it's like" "and well" "to be completely honest" "yeah" ];
    fillerPad = 0.07;
  };

  home.stateVersion = "24.11";
}
