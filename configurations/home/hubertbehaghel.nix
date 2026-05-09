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
      self.homeModules.emacs
      self.homeModules.texlive
      self.homeModules.password-store
      self.homeModules.linux-only
    ];
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
  ] ++ lib.optionals isLinux [
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

  hub.opencode.modelConfigMode = "openai-only";

  home.stateVersion = "24.11";
}
