{
    enableKeyMapping = true;
    mappings = let
      commonMappings = { "Keyboard Caps Lock" = "Keyboard Escape"; };
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
          { # cmd <=> alt
            "Keyboard Left GUI" = "Keyboard Left Alt";
            "Keyboard Left Alt" = "Keyboard Left GUI";
            # altgr
            "Keyboard Right GUI" = "Keyboard Right Alt";
          } // commonMappings;
      }
    ];
}
