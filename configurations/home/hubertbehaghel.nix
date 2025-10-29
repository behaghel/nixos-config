{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
(
{
  imports = [
    self.homeModules.default
    self.homeModules.dev
    self.homeModules.browserpass
    self.homeModules.emacs
    self.homeModules."video-editing"
  ];
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

  hub.mail.enable = true;
  hub.videoEditing = {
    enable = true;
    fillerWords = [ "uh" "um" "and you know" "and so" "and so for us" "so for us" "you know" "kind of" "a bit" "a bit of" "it's like" "and well" "to be completely honest" "yeah"];
    fillerPad = 0.07;
  };

  home.stateVersion = "24.11";
}
  // lib.optionalAttrs pkgs.stdenv.isLinux {
    imports = lib.mkAfter [
      self.homeModules.linux-only
      self.homeModules.dropbox
    ];
    hub.dropbox.enable = true;
    # Enable IMAP IDLE notifier (goimapnotify) for work mailbox
    hub.mail.imapnotify = {
      enable = true;
      accounts = [ "work" ];
      notify = true;
    };
  }
  // lib.optionalAttrs pkgs.stdenv.isDarwin {
    imports = lib.mkAfter [
      self.homeModules.darwin-only
    ];
  }
)
