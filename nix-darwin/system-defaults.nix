{pkgs, ...}:
{
  security.pam.enableSudoTouchIdAuth = true;
  system = {
    # Used for backwards compatibility, please read the changelog before changing.
    # $ darwin-rebuild changelog
    stateVersion = 4;

    defaults = {
      finder = {
        AppleShowAllExtensions = true;
        FXEnableExtensionChangeWarning = false;
        CreateDesktop = false; # disable desktop icons
      };
      NSGlobalDomain = {
        # "com.apple.trackpad.scaling"       = "3.0";
        AppleFontSmoothing                   = 1;
        # don't ruin vim motions in Terminal
        ApplePressAndHoldEnabled             = false;
        AppleKeyboardUIMode                  = 3;
        AppleMeasurementUnits                = "Centimeters";
        AppleMetricUnits                     = 1;
        AppleShowScrollBars                  = "Automatic";
        AppleShowAllExtensions               = true;
        AppleTemperatureUnit                 = "Celsius";
        # InitialKeyRepeat                   = 15;
        KeyRepeat                            = 2;
        NSAutomaticCapitalizationEnabled     = false;
        NSAutomaticSpellingCorrectionEnabled = false;
        NSAutomaticPeriodSubstitutionEnabled = false;
        # _HIHideMenuBar                       = true;
        NSNavPanelExpandedStateForSaveMode = true;
        NSNavPanelExpandedStateForSaveMode2 = true;
        # Enable full keyboard access for all controls
        # (e.g. enable Tab in modal dialogs)
      };
      dock = {
        autohide = true;
        mru-spaces = false;
        minimize-to-application = true;
      };
      SoftwareUpdate.AutomaticallyInstallMacOSUpdates = false;
    };
  };
  # Auto upgrade nix package and the daemon service.
  services.nix-daemon.enable = true;
}
