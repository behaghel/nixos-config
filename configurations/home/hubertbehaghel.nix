{ flake, pkgs, lib, config, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
  isLinux = pkgs.stdenv.isLinux;
  claudeCodePkg = inputs.claude-code.packages.${pkgs.stdenv.hostPlatform.system}.claude-code;
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
      self.homeModules.linux-only
      self.homeModules.darwin-only
    ];
  services.local-modules.nix-darwin.keyboard.bepo.enable = true;
  programs.gpg.useNixGPG = true;
  # On macOS, require PIN entry for every card operation (no agent caching)
  programs.gpg.requirePinAlways = lib.mkIf (!isLinux) true;

  # Defined by /modules/home/me.nix
  # And used all around in /modules/home/*
  me = {
    username = "hubertbehaghel";
    fullname = "Hubert Behaghel";
    email = "hubert.behaghel@veriff.net";
  };

  home.packages = with pkgs; [
    gemini-cli
    codex
  ] ++ [
    claudeCodePkg
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

  targets.genericLinux.enable = isLinux;

  hub.syncthing.enable = lib.mkIf (!isLinux) true;

  hub.videoEditing = {
    enable = true;
    fillerWords = [ "uh" "um" "and you know" "and so" "and so for us" "so for us" "you know" "kind of" "a bit" "a bit of" "it's like" "and well" "to be completely honest" "yeah" ];
    fillerPad = 0.07;
  };

  home.stateVersion = "24.11";
}
