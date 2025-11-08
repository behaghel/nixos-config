{ config, lib, pkgs, ... }:

with lib;
let
  cfg = attrByPath [ "services" "local-modules" "nix-darwin" "keyboard" ] { } config;
  cfgMappingsList =
    if cfg.mappings == null then
      [ ]
    else if builtins.isList cfg.mappings then
      cfg.mappings
    else
      [ cfg.mappings ];
  hasDeviceMappings = cfgMappingsList != [ ];

  globalKeyMappings = { }
    // (if cfg.remapCapsLockToControl then { "Keyboard Caps Lock" = "Keyboard Left Control"; } else { })
    // (if cfg.remapCapsLockToEscape then { "Keyboard Caps Lock" = "Keyboard Escape"; } else { })
    // (if cfg.nonUS.remapTilde then { "Keyboard Non-US # and ~" = "Keyboard Grave Accent and Tilde"; } else { });

  keyMappingTable = (
    mapAttrs
      (name: value:
        # hidutil accepts values that consists of 0x700000000 binary ORed with the
        # desired keyboard usage value.
        #
        # The actual number can be base-10 or hexadecimal.
        # 0x700000000
        #
        # 30064771072 == 0x700000000
        #
        # https://developer.apple.com/library/archive/technotes/tn2450/_index.html
        bitOr 30064771072 value)
      (import ./hid-usage-table.nix)
  ) // {
    # These are not documented, but they work with hidutil.
    #
    # Sources:
    # https://apple.stackexchange.com/a/396863/383501
    # http://www.neko.ne.jp/~freewing/software/macos_keyboard_setting_terminal_commandline/
    "Keyboard Left Function (fn)" = 1095216660483;
    "Keyboard Right Function (fn)" = 280379760050179;
  };

  keyMappingTableKeys = attrNames keyMappingTable;

  isValidKeyMapping = key: elem key keyMappingTableKeys;

  # Note: We previously used an external helper (xpc_set_event_stream_handler)
  # to consume IOKit matching events. Modern launchd supports LaunchEvents
  # directly; we rely on LaunchEvents and drop the helper to avoid legacy SDK
  # build issues on recent nixpkgs.

  mappingOptions = types.submodule {
    options = {
      productId = mkOption {
        type = types.int;
        description = '';
          Product ID of the keyboard which should have this mapping applied.  To find the Product ID of a keyboard, you can check the output of <literal>hidutil list --matching keyboard</literal>.

          Note that you have to convert the value from hexadecimal to decimal because Nix only has base 10 integers.  For example: <literal>printf "%d" 0x27e</literal>
        '';
      };

      vendorId = mkOption {
        type = types.int;
        description = '';
          Vendor ID of the keyboard which should have this mapping applied.  To find the Vendor ID of a keyboard, you can check the output of <literal>hidutil list --matching keyboard</literal>.

          Note that you have to convert the value from hexadecimal to decimal because Nix only has base 10 integers.  For example: <literal>printf "%d" 0x5ac</literal>
        '';
      };

      mappings = mkOption {
        type = types.attrsOf (types.enum keyMappingTableKeys);
        description = ''
          Mappings that should be applied.  To see what values are available, check <link xlink:href="https://github.com/LnL7/nix-darwin/blob/master/modules/system/keyboard/hid-usage-table.nix"/>.
        '';
      };
    };
  };
in
{
  options = {
    services.local-modules.nix-darwin.keyboard.enableKeyMapping = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to enable keyboard mappings.";
    };

    services.local-modules.nix-darwin.keyboard.remapCapsLockToControl = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to remap the Caps Lock key to Control.";
    };

    services.local-modules.nix-darwin.keyboard.remapCapsLockToEscape = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to remap the Caps Lock key to Escape.";
    };

    services.local-modules.nix-darwin.keyboard.nonUS.remapTilde = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to remap the Tilde key on non-us keyboards.";
    };

    services.local-modules.nix-darwin.keyboard.disableInputSourceHotkeys = mkOption {
      type = types.bool;
      default = true;
      description = "Disable macOS input source switch hotkeys (e.g., Ctrl+Space) that interfere with terminal/editor usage.";
    };

    services.local-modules.nix-darwin.keyboard.spaces.directDesktopShortcuts.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Enable direct desktop switching shortcuts (Ctrl+1..9).";
    };

    services.local-modules.nix-darwin.keyboard.tilingShortcuts.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Enable native window tiling shortcuts (Ctrl+Option+Cmd+Arrows/=/-/C).";
    };

    services.local-modules.nix-darwin.keyboard.mappings = mkOption {
      type = types.nullOr (types.either mappingOptions (types.listOf mappingOptions));
      default = null;
      description = ''
        Either an attribute set of key mappings (that will be applied to all keyboards), or a list of attribute sets of key mappings (mappings that will be applied to keyboards with specific Product IDs).
      '';
      example = literalExample ''
        services.local-modules.nix-darwin.keyboard.enableKeyMapping = true;
        services.local-modules.nix-darwin.keyboard.mappings = [
          {
            productId = 273;
            vendorId = 2131;
            mappings = {
              "Keyboard Caps Lock" = "Keyboard Left Function (fn)";
            };
          }
          {
            productId = 638;
            vendorId = 1452;
            mappings = {
              # For the built-in MacBook keyboard, change the modifiers to match a
              # traditional keyboard layout.
              "Keyboard Caps Lock" = "Keyboard Left Function (fn)";
              "Keyboard Left Alt" = "Keyboard Left GUI";
              "Keyboard Left Function (fn)" = "Keyboard Left Control";
              "Keyboard Left GUI" = "Keyboard Left Alt";
              "Keyboard Right Alt" = "Keyboard Right Control";
              "Keyboard Right GUI" = "Keyboard Right Alt";
            };
          }
        ];
      '';
    };
  };

  config = mkMerge [
    {

    assertions =
      let
        mkAssertion = { element, productId ? null, ... }: {
          assertion = isValidKeyMapping element;
          message = "${element} ${if productId != null then "in mapping for ${productId}" else ""} must be one of ${builtins.toJSON keyMappingTableKeys}";
        };
      in
      (
        flatten
          (optionals hasDeviceMappings
            (
              map
                ({ productId, mappings, ... }:
                  (mapAttrsToList
                    (src: dest: [
                      (mkAssertion { inherit productId; element = src; })
                      (mkAssertion { inherit productId; element = dest; })
                    ])
                    mappings
                  )
                )
                cfgMappingsList
            ) ++ (
            mapAttrsToList
              (src: dest: [
                (mkAssertion { element = src; })
                (mkAssertion { element = dest; })
              ])
              globalKeyMappings
          )) ++ [
          {
            assertion = !(hasDeviceMappings && (length (attrNames globalKeyMappings) > 0));
            message = "Configuring both global and device-specific key mappings is not reliable, please use one or the other.";
          }
          {
            assertion = !(cfg.remapCapsLockToControl && cfg.remapCapsLockToEscape);
            message = "Cannot remap Caps Lock to both Control and Escape; pick one.";
          }
        ]
      );

    warnings = [ ]
      ++ (
      optional
        (!cfg.enableKeyMapping && (hasDeviceMappings || globalKeyMappings != { }))
        "services.local-modules.nix-darwin.keyboard.enableKeyMapping is false, keyboard mappings will not be configured."
    )
      ++ (
      optional
        (cfg.enableKeyMapping && (!hasDeviceMappings && globalKeyMappings == { }))
        "services.local-modules.nix-darwin.keyboard.enableKeyMapping is true but you have not configured any key mappings."
    );

    launchd.user.agents =
      let
        mkUserKeyMapping = mapping: builtins.toJSON ({
          UserKeyMapping = (
            mapAttrsToList
              (src: dst: {
                HIDKeyboardModifierMappingSrc = keyMappingTable."${src}";
                HIDKeyboardModifierMappingDst = keyMappingTable."${dst}";
              })
              mapping
          );
        });
        mkDisableInputHotkeysAgent =
          if pkgs.stdenv.isDarwin && (cfg.disableInputSourceHotkeys or false) then {
            keyboard-hotkeys = {
              serviceConfig.ProgramArguments = [
                "${pkgs.writeScriptBin "disable-input-hotkeys" ''
                  #!${pkgs.stdenv.shell}
                  set -euo pipefail

                  # Disable macOS shortcuts that steal Ctrl+Space from terminals
                  PLIST=com.apple.symbolichotkeys
                  PLIST_PATH="$HOME/Library/Preferences/$PLIST.plist"

                  /usr/bin/defaults read "$PLIST" >/dev/null 2>&1 || true

                  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
                    for key in 60 61; do
                      if /usr/libexec/PlistBuddy -c "Print :AppleSymbolicHotKeys:$key" "$PLIST_PATH" >/dev/null 2>&1; then
                        /usr/libexec/PlistBuddy -c "Set :AppleSymbolicHotKeys:$key:enabled false" "$PLIST_PATH" 2>/dev/null || true
                      else
                        /usr/libexec/PlistBuddy -c "Add :AppleSymbolicHotKeys:$key dict" "$PLIST_PATH" 2>/dev/null || true
                        /usr/libexec/PlistBuddy -c "Add :AppleSymbolicHotKeys:$key:enabled bool false" "$PLIST_PATH" 2>/dev/null || true
                      fi
                    done
                  else
                    /usr/bin/defaults write "$PLIST" AppleSymbolicHotKeys -dict-add 60 '{ enabled = 0; }' || true
                    /usr/bin/defaults write "$PLIST" AppleSymbolicHotKeys -dict-add 61 '{ enabled = 0; }' || true
                  fi

                  /usr/bin/killall -u "$USER" cfprefsd 2>/dev/null || true
                ''}/bin/disable-input-hotkeys"
              ];
              serviceConfig.RunAtLoad = true;
            };
          } else {};

        mkDirectDesktopShortcutsAgent =
          if pkgs.stdenv.isDarwin && (cfg.spaces.directDesktopShortcuts.enable or false) then {
            keyboard-desktops = {
              serviceConfig.ProgramArguments = [
                "${pkgs.writeScriptBin "configure-desktop-shortcuts" ''
                  #!${pkgs.stdenv.shell}
                  set -euo pipefail

                  PLIST=com.apple.symbolichotkeys
                  # Keycodes for digits 1..9 in macOS (US layout):
                  # 1:18 2:19 3:20 4:21 5:23 6:22 7:26 8:28 9:25
                  # ASCII codes for '1'..'9' are 49..57.
                  ids=(118 119 120 121 122 123 124 125 126)
                  keycodes=(18 19 20 21 23 22 26 28 25)

                  for i in "''${!ids[@]}"; do
                    id="''${ids[$i]}"
                    kc="''${keycodes[$i]}"
                    ascii=$((49 + i))
                    /usr/bin/defaults write "$PLIST" AppleSymbolicHotKeys -dict-add "$id" "{ enabled = 1; value = { parameters = ( $ascii, $kc, 262144 ); type = standard; }; }" || true
                  done

                  # Ensure left/right space navigation is on (IDs 79,80)
                  /usr/bin/defaults write "$PLIST" AppleSymbolicHotKeys -dict-add 79 '{ enabled = 1; }' || true
                  /usr/bin/defaults write "$PLIST" AppleSymbolicHotKeys -dict-add 80 '{ enabled = 1; }' || true

                  /usr/bin/killall -u "$USER" cfprefsd 2>/dev/null || true
                ''}/bin/configure-desktop-shortcuts"
              ];
              serviceConfig.RunAtLoad = true;
              serviceConfig.StandardOutPath = "/tmp/keyboard-desktops.log";
              serviceConfig.StandardErrorPath = "/tmp/keyboard-desktops.log";
            };
          } else {};

        mkTilingShortcutsAgent =
          if pkgs.stdenv.isDarwin && (cfg.tilingShortcuts.enable or false) then {
            keyboard-tiling = {
              serviceConfig.ProgramArguments = [
                "${pkgs.writeScriptBin "configure-tiling-shortcuts" ''
                  #!${pkgs.stdenv.shell}
                  set -euo pipefail

                  # Bind native window tiling/menu actions to Ctrl+Option+Cmd chords.
                  # Modifiers: ^ (Ctrl), ~ (Option), @ (Command)
                  # Arrows use their Unicode glyphs.
                  add_shortcut() {
                    local title="$1"; shift
                    local chord="$1"; shift
                    /usr/bin/defaults write -g NSUserKeyEquivalents -dict-add "$title" -string "$chord" || true
                  }

                  add_shortcut "Move to Left Side of Screen"  "^~@←"
                  add_shortcut "Move to Right Side of Screen" "^~@→"
                  # Legacy menu titles for compatibility
                  add_shortcut "Tile Window to Left of Screen"  "^~@←"
                  add_shortcut "Tile Window to Right of Screen" "^~@→"

                  add_shortcut "Make Larger"  "^~@="
                  add_shortcut "Make Smaller" "^~@-"
                  add_shortcut "Center Window" "^~@c"

                  /usr/bin/killall -u "$USER" cfprefsd 2>/dev/null || true
                ''}/bin/configure-tiling-shortcuts"
              ];
              serviceConfig.RunAtLoad = true;
              serviceConfig.StandardOutPath = "/tmp/keyboard-tiling.log";
              serviceConfig.StandardErrorPath = "/tmp/keyboard-tiling.log";
            };
          } else {};
      in
      (if (cfg.enableKeyMapping && length (attrNames globalKeyMappings) > 0) then
        {
          keyboard = ({
            serviceConfig.ProgramArguments = [
              "${pkgs.writeScriptBin "apply-keybindings" ''
                  #!${pkgs.stdenv.shell}
                  set -euo pipefail

                  echo "$(date) configuring keyboard..." >&2
                  hidutil property --set '${mkUserKeyMapping globalKeyMappings}' > /dev/null
                ''}/bin/apply-keybindings"
            ];
            # Periodically re-apply to handle post-boot and re-enumeration quirks.
            serviceConfig.StartInterval = 60;
            serviceConfig.LaunchEvents = {
              "com.apple.iokit.matching" = {
                "com.apple.usb.device" = {
                  IOMatchLaunchStream = true;
                  IOProviderClass = "IOUSBDevice";
                  idProduct = "*";
                  idVendor = "*";
                };
              };
            };
            serviceConfig.RunAtLoad = true;
          });
        }
      else if (cfg.enableKeyMapping && hasDeviceMappings) then
        (listToAttrs (map
          ({ mappings
           , productId
           , vendorId
           , ...
           }:
           let
             hasCapsEscape = (
               (mappings ? "Keyboard Caps Lock") && (mappings."Keyboard Caps Lock" == "Keyboard Escape")
             );
             capsOnlyJSON = if hasCapsEscape then mkUserKeyMapping { "Keyboard Caps Lock" = "Keyboard Escape"; } else null;
             isAppleInternal = (vendorId == 1452 && productId == 833);
           in (nameValuePair "keyboard-${toString productId}" ({
             serviceConfig.ProgramArguments = [
              "${pkgs.writeScriptBin "apply-keybindings" (
                let intToHexString = value:
                  pkgs.runCommand "${toString value}-to-hex-string"
                      { } ''printf "%#0x" ${toString value} > $out''; in
                ''
                  #!${pkgs.stdenv.shell}
                  set -euxo pipefail

                  LOG_DIR="$HOME/Library/Logs"
                  LOG_FILE="$LOG_DIR/keyboard-${toString productId}.log"
                  /bin/mkdir -p "$LOG_DIR" 2>/dev/null || true

                  # Sometimes it takes a moment for the keyboard to be
                  # visible to hidutil, even when the script is launched
                  # with "LaunchEvents".
                  function retry () {
                    local attempt=1
                    local max_attempts=60
                    local delay=1

                    while true; do
                      "$@" && break || {
                        if (test $attempt -lt $max_attempts); then
                          attempt=$((attempt + 1))
                          sleep $delay
                        else
                          # Do not exit the script here; return non-zero
                          # so callers can handle fallback paths.
                          return 1
                        fi
                      }
                    done
                  }

                  function get_vendor_id () {
                    hidutil list --matching keyboard |
                      awk '{ print $1 }' |
                      grep $(<${intToHexString vendorId})
                  }

                  function get_product_id () {
                    hidutil list --matching keyboard |
                      awk '{ print $2 }' |
                      grep $(<${intToHexString productId})
                  }

                  function internal_keyboard_present () {
                    hidutil list --matching keyboard | grep -q 'Apple Internal Keyboard / Trackpad'
                  }

                  echo "$(date) configuring keyboard ${toString productId} ($(<${intToHexString productId}))..." | tee -a "$LOG_FILE" >&2

                  # Vendor ID may be 0 for internal keyboards post-boot; don't hard-fail.
                  retry get_vendor_id || true
                  if retry get_product_id; then
                    echo "$(date) matched ProductID ${toString productId}; applying device-specific mappings" | tee -a "$LOG_FILE" >&2
                    hidutil property --matching '${builtins.toJSON { ProductID = productId; }}' --set '${mkUserKeyMapping mappings}' > /dev/null
                    echo "$(date) per-device mapping now (by ProductID): $(hidutil property --matching '${builtins.toJSON { ProductID = productId; }}' --get 'UserKeyMapping' 2>/dev/null | tr -d '\n')" | tee -a "$LOG_FILE" >&2
                  else
                    # Fallback by product name only for Apple Internal keyboard where IDs can be 0
                    if internal_keyboard_present && ${if isAppleInternal then "true" else "false"}; then
                      echo "$(date) Product/Vendor ID not reported; applying by Product name (internal keyboard)" | tee -a "$LOG_FILE" >&2
                      hidutil property --matching '{ "Product": "Apple Internal Keyboard / Trackpad", "Built-In": 1 }' --set '${mkUserKeyMapping mappings}' > /dev/null
                      echo "$(date) per-device mapping now (by Product+Built-In): $(hidutil property --matching '{ \"Product\": \"Apple Internal Keyboard / Trackpad\", \"Built-In\": 1 }' --get 'UserKeyMapping' 2>/dev/null | tr -d '\n')" | tee -a "$LOG_FILE" >&2
                    else
                      echo "$(date) WARNING: Could not identify target keyboard for mapping ${toString productId}. Skipping." | tee -a "$LOG_FILE" >&2
                    fi
                  fi
                  echo "$(date) current UserKeyMapping: $(hidutil property --get 'UserKeyMapping' 2>/dev/null | tr -d '\n')" | tee -a "$LOG_FILE" >&2
                ''
                )}/bin/apply-keybindings"
            ];
            # Re-apply periodically to handle device re-enumeration after sleep/wake.
            serviceConfig.StartInterval = 15;
            serviceConfig.RunAtLoad = true;
            serviceConfig.KeepAlive = { SuccessfulExit = false; };
            # Also react to USB device matching events (helps external keyboards)
            serviceConfig.LaunchEvents = {
              "com.apple.iokit.matching" = {
                "com.apple.usb.device" = {
                  IOMatchLaunchStream = true;
                  IOProviderClass = "IOUSBDevice";
                  idProduct = "*";
                  idVendor = "*";
                };
              };
            };
            # Conservative logging paths (script also logs to ~/Library/Logs)
            serviceConfig.StandardOutPath = "/tmp/keyboard-${toString productId}.log";
            serviceConfig.StandardErrorPath = "/tmp/keyboard-${toString productId}.log";
          })
          ))
          cfgMappingsList
        )) else { })
      // mkDisableInputHotkeysAgent
      // mkDirectDesktopShortcutsAgent
      // mkTilingShortcutsAgent;
    services.local-modules.nix-darwin.keyboard = import ./config.nix;
    }
  ];
}
