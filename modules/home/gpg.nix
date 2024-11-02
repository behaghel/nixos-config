{
  programs.gpg = {
    enable = true;
    settings = {
      # Your gpg.conf settings here if needed
    };
  };
  services.gpg-agent = {
    enable = true;
    enableSshSupport = true;
    grabKeyboardAndMouse = true;
    enableScDaemon = false;
    # pinentryPackage = null;
    # Additional gpg-agent settings if needed
    extraConfig = ''
      allow-preset-passphrase
      allow-loopback-pinentry
      allow-emacs-pinentry
    '';
  };
}