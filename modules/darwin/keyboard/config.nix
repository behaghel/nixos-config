rec {
    # Key remap toggles (Realforce): set to true to swap GUI<->Alt on left/right.
    swapLeftGuiAlt = true;
    swapRightGuiAlt = false;
    enableKeyMapping = true;
  spaces = {
    directDesktopShortcuts = {
      # Manage direct Ctrl+1..9 Desktop switching via Nix.
      enable = true;
      # Do not require Shift with digits (use Ctrl+<digit>), matching current behavior.
      useShiftForDigits = false;
    };
  };
  tilingShortcuts = {
    enable = false;
  };
    mappings = let
      commonMappings = { "Keyboard Caps Lock" = "Keyboard Escape"; };
      optAttrs = cond: attrs: if cond then attrs else {};
    in [
      {
        # builtin keyboard
        # Vendor ID:	0x05ac => 1452 (Apple Inc.)
        # Product ID:	0x0341 => 833
        vendorId = 1452;
        productId = 833;
        mappings = { # right alt -> right control
          "Keyboard Right Alt" = "Keyboard Right Control";
          # right cmd -> right alt
          "Keyboard Right GUI" = "Keyboard Right Alt";
        } // commonMappings;
      }
      {
        # Realforce
        # Vendor ID: 0x853 => 2131
        # Product ID: 0x124 => 292
        vendorId = 2131;
        productId = 292;
        mappings =
          (optAttrs swapLeftGuiAlt {
            "Keyboard Left GUI" = "Keyboard Left Alt";
            "Keyboard Left Alt" = "Keyboard Left GUI";
          }) //
          (optAttrs swapRightGuiAlt {
            "Keyboard Right GUI" = "Keyboard Right Alt";
            "Keyboard Right Alt" = "Keyboard Right GUI";
          }) //
          commonMappings;
      }
    ];
}
