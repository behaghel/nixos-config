{ flake, pkgs, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.homeModules.default
    self.homeModules.linux-only
    self.homeModules.dev
    self.homeModules.browserpass
    self.homeModules.emacs
    self.homeModules.dropbox
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
  hub.dropbox.enable = true;
  hub.videoEditing.enable = true;
  # Enable IMAP IDLE notifier (goimapnotify) for work mailbox
  hub.mail.imapnotify = {
    enable = true;
    accounts = [ "work" ];
    notify = true;
  };

  home.stateVersion = "24.11";
}
