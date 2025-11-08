#
# When this module is enabled it will override system shortcuts,
# but only those that it knows about. Defaults are the same as in system,
# except where we intentionally diverge (see inputSources and missionControl).
#
# Only some of the shortcuts have been implemented. Please, add more!
#
# To add a new shortcut, you need to know:
#
# * its numeric id,
# * default value (enabled or not and the key combo).
#
# The shorcuts are stored in `~/Library/Preferences/com.apple.symbolichotkeys.plist`.
# This file is a binary plist, so the first thing you need to do is
# convert it to XML:
#
# * plutil -convert xml1 ~/Library/Preferences/com.apple.symbolichotkeys.plist
#
# Now copy this file somewhere.
#
# Next go to System Preferences → Keyboard → Shortcuts, find the shortcut you
# are interested in, change something in it. Convert the file above to XML again
# and diff with the saved copy. The `key` of the changed entry is the numeric id
# of the shortcut. Press “Restore Defaults” in preferences to find out the default
# key combo.
#
# After you are done, copy your saved plist back and re-login just in case.
#

{ config, lib, pkgs, ... }:

let
  inherit (lib) attrsets lists options types;

  cfg = config.system.keyboard.shortcuts;
  kbCfg = config.services.local-modules.nix-darwin.keyboard or {};

  modNames = attrsets.genAttrs ["shift" "control" "option" "command"] (x: x);

  # NOTE:
  # What comes below does not seem to be documented, so these are merely
  # reverse-engineered guesses.

  # /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/IOKit.framework/Headers/hidsystem/IOLLEvent.h
  modMasks = {
    shift   = 131072;  # 0x00020000
    control = 262144;  # 0x00040000
    option  = 524288;  # 0x00080000
    command = 1048576; # 0x00100000
  };

  # /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/Carbon.framework/Frameworks/HIToolbox.framework/Headers/Events.h
  keyCodes = {
    "A"  = 0;  # 0x00
    "S"  = 1;  # 0x01
    "D"  = 2;  # 0x02
    "F"  = 3;  # 0x03
    "H"  = 4;  # 0x04
    "G"  = 5;  # 0x05
    "Z"  = 6;  # 0x06
    "X"  = 7;  # 0x07
    "C"  = 8;  # 0x08
    "V"  = 9;  # 0x09
    "B"  = 11; # 0x0B
    "Q"  = 12; # 0x0C
    "W"  = 13; # 0x0D
    "E"  = 14; # 0x0E
    "R"  = 15; # 0x0F
    "Y"  = 16; # 0x10
    "T"  = 17; # 0x11
    "1"  = 18; # 0x12
    "2"  = 19; # 0x13
    "3"  = 20; # 0x14
    "4"  = 21; # 0x15
    "6"  = 22; # 0x16
    "5"  = 23; # 0x17
    "="  = 24; # 0x18
    "9"  = 25; # 0x19
    "7"  = 26; # 0x1A
    "-"  = 27; # 0x1B
    "8"  = 28; # 0x1C
    "0"  = 29; # 0x1D
    "]"  = 30; # 0x1E
    "O"  = 31; # 0x1F
    "U"  = 32; # 0x20
    "["  = 33; # 0x21
    "I"  = 34; # 0x22
    "P"  = 35; # 0x23
    "L"  = 37; # 0x25
    "J"  = 38; # 0x26
    "'"  = 39; # 0x27
    "K"  = 40; # 0x28
    ";"  = 41; # 0x29
   "\\"  = 42; # 0x2A
    ","  = 43; # 0x2B
    "/"  = 44; # 0x2C
    "N"  = 45; # 0x2D
    "M"  = 46; # 0x2E
    "."  = 47; # 0x2F
    "`"  = 50; # 0x32

    "return" = 36;  # 0x24
    "tab"    = 48;  # 0x30
    "space"  = 49;  # 0x31
    "delete" = 51;  # 0x33
    "escape" = 53;  # 0x35
    "left"   = 123; # 0x7B
    "right"  = 124; # 0x7C
    "down"   = 125; # 0x7D
    "up"     = 126; # 0x7E

    "f17" = 64;  # 0x40
    "f18" = 79;  # 0x4F
    "f19" = 80;  # 0x50
    "f20" = 90;  # 0x5A
    "f5"  = 96;  # 0x60
    "f6"  = 97;  # 0x61
    "f7"  = 98;  # 0x62
    "f3"  = 99;  # 0x63
    "f8"  = 100; # 0x64
    "f9"  = 101; # 0x65
    "f11" = 103; # 0x67
    "f13" = 105; # 0x69
    "f16" = 106; # 0x6A
    "f14" = 107; # 0x6B
    "f10" = 109; # 0x6D
    "f12" = 111; # 0x6F
    "f15" = 113; # 0x71
    "f4"  = 118; # 0x76
    "f2"  = 120; # 0x78
    "f1"  = 122; # 0x7A


    "keypad."     = 65; # 0x41
    "keypad*"     = 67; # 0x43
    "keypad+"     = 69; # 0x45
    "keypadClear" = 71; # 0x47
    "keypad/"     = 75; # 0x4B
    "keypadEnter" = 76; # 0x4C
    "keypad-"     = 78; # 0x4E
    "keypad="     = 81; # 0x51
    "keypad0"     = 82; # 0x52
    "keypad1"     = 83; # 0x53
    "keypad2"     = 84; # 0x54
    "keypad3"     = 85; # 0x55
    "keypad4"     = 86; # 0x56
    "keypad5"     = 87; # 0x57
    "keypad6"     = 88; # 0x58
    "keypad7"     = 89; # 0x59
    "keypad8"     = 91; # 0x5B
    "keypad9"     = 92; # 0x5C
  };

  modsOptions = attrsets.genAttrs (attrsets.attrNames modNames) (modName:
    options.mkOption {
      type = types.bool;
      default = false;
      example = true;
      description = "Use the `${modName}` modifier in the combination";
    });

  shortcutOptions = id: enable: mods: key: {
    id = options.mkOption {
      internal = true;
      visible = false;
      readOnly = true;
      default = id;
      type = types.int;
      description = "Shortcut numeric key in the plist dict";
    };
    enable = options.mkOption {
      type = types.bool;
      default = enable;
      example = true;
      description = "Whether to enable this shortcut";
    };
    mods = options.mkOption {
      type = types.submodule { options = modsOptions; };
      default = attrsets.genAttrs mods (_: true);
      description = "Modifiers for this combination";
    };
    key = options.mkOption {
      type = types.nullOr (types.enum (attrsets.attrNames keyCodes));
      example = "delete";
      description = "Final key of the combination";
      default = key;
      apply = val: if val == null then 65535 else attrsets.getAttr val keyCodes;
    };
  };

  mkShortcut = id: description: enable: mods: key:
    options.mkOption {
      inherit description;
      type = types.submodule { options = shortcutOptions id enable mods key; };
      default = {};
      example = options.literalExpression ''
        {
          enable = true;
          mods = {
            option = true;
            control = true;
          };
          key = "delete";
        }
      '';
    };

  encodeShortcut = config: let
    reverseLookup = val: let 
      keys = builtins.attrNames keyCodes;
      matchingKeys = builtins.filter (k: keyCodes.${k} == val) keys;
    in
      if matchingKeys == [] then null else builtins.head matchingKeys;

    # TODO: this is brittle, probably incorrect and based on this comment https://stackoverflow.com/a/23318003 
    # > It is the ascii code of the letter on the key, or -1 (65535) if there is no ascii code. Note that letters are lowercase, so D is 100 (lowercase d).
    # > Sometimes a key that would normally have an ascii code uses 65535 instead. This appears to happen when the control key modifier is used, for example with hot keys for specific spaces.
    keyCodeToAscii = config : 
      let 
        code = config.key;
        mods = config.mods;
        isAsciish = code : (code >=  0 && code < 36)
              || (code >= 37 && code < 48)
              || (code == 50 );
      in
        # Apart from the control modifier, it seems that for instance command option d is 65535
        # deal with ascii-ish keycodes and convert them to an ascii code.
        if (!mods.control && !(mods.command && mods.option) && isAsciish code) then
          (lib.strings.charToInt (lib.strings.toLower (reverseLookup code)))
        # "return"
        else if (!mods.control && code == 36) then 10
        # "tab"
        else if (!mods.control && code == 48) then 9
        # "space"
        else if (!mods.control && code == 49) then 32
        # "delete"
        else if (!mods.control && code == 51) then 127
        # assume (probably incorrectly) that the rest map to the magic code 65535
        else 65535;

  in {
    name = toString config.id;
    value = {
      enabled = config.enable;
      value = {
        parameters = [
          (keyCodeToAscii config)
          config.key
          (lib.pipe modMasks [
            (attrsets.filterAttrs (mod: _: attrsets.getAttr mod config.mods))
            attrsets.attrValues
            (lists.foldl' lib.add 0)
          ])
        ];
        type = "standard";  # No idea what other possible values are
      };
    };
  };

  encodeShortcuts = shortcuts:
    builtins.toJSON (builtins.listToAttrs (map encodeShortcut shortcuts));
in

{
  options.system.keyboard.shortcuts = with modNames; {
    enable = options.mkEnableOption "keyboard shorcuts";

    # the otherwise undocumented complete list of magic numbers for system hotkeys
    # is here https://gist.github.com/mkhl/455002#file-ctrl-f1-c-L12 

    launchpadDock = {
      dockHiding = mkShortcut 52 "Turn Dock hiding on/off" true [option command] "D";
      showLaunchpad = mkShortcut 160 "Show Launchpad" false [] null;
    };

    missionControl = {
      moveLeftSpace  = mkShortcut 79 "Move left a space" true [control] "left";
      moveRightSpace = mkShortcut 80 "Move right a space" true [control] "right";
      # Direct desktop switching (Ctrl+1..9) using physical digit keycodes.
      # macOS uses IDs 118..126 for Desktop 1..9.
      desktop1 = mkShortcut 118 "Switch to Desktop 1" true [control] "1";
      desktop2 = mkShortcut 119 "Switch to Desktop 2" true [control] "2";
      desktop3 = mkShortcut 120 "Switch to Desktop 3" true [control] "3";
      desktop4 = mkShortcut 121 "Switch to Desktop 4" true [control] "4";
      desktop5 = mkShortcut 122 "Switch to Desktop 5" true [control] "5";
      desktop6 = mkShortcut 123 "Switch to Desktop 6" true [control] "6";
      desktop7 = mkShortcut 124 "Switch to Desktop 7" true [control] "7";
      desktop8 = mkShortcut 125 "Switch to Desktop 8" true [control] "8";
      desktop9 = mkShortcut 126 "Switch to Desktop 9" true [control] "9";
    };

    inputSources = {
      # Disable both to let Ctrl+Space reach zsh and editors
      prev = mkShortcut 60 "Select previous input source" false [control] "space";
      next = mkShortcut 61 "Select next input source" false [control option] "space";
    };

    spotlight = {
      # search = mkShortcut 64 "Show Spotlight search" true [command] "space";
      # until we learn how to override this correctly
      search = mkShortcut 64 "Show Spotlight search" false [command] "space";
      finderSearch = mkShortcut 65 "Show Finder search" true [option command] "space";
    };
  };

  config =
    let
      # The shortcuts plist uses nested dicts and updating those is _really_
      # tricky without having a real programming language at hand.
      # In particular, `defaults` can’t make sure the nested types are correct
      # and PlistBuddy cannot do “update or create”.
      updateShortcuts = pkgs.writeScript "updateShortcuts.py" ''
        #!${pkgs.python3.interpreter}

        import json
        from os.path import expanduser
        import plistlib
        import sys
        import os

        # Args: <jsonSpecPath> [targetPlistPath]
        spec_path = sys.argv[1]
        target_path = expanduser(sys.argv[2]) if len(sys.argv) > 2 else expanduser('~/Library/Preferences/com.apple.symbolichotkeys.plist')

        try:
          with open(target_path, 'rb') as f:
            plist = plistlib.load(f)
        except FileNotFoundError:
          # Create minimal structure if missing
          plist = { 'AppleSymbolicHotKeys': {} }

        with open(spec_path, 'rb') as f:
          updates = json.load(f)

        if 'AppleSymbolicHotKeys' not in plist or not isinstance(plist['AppleSymbolicHotKeys'], dict):
          plist['AppleSymbolicHotKeys'] = {}

        plist['AppleSymbolicHotKeys'].update(updates)

        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, 'wb') as f:
          plistlib.dump(plist, f)
      '';
      shortcutsSpec = pkgs.writeTextFile {
        name = "shortcutsSpec.json";
        text = encodeShortcuts (attrsets.collect (s: s ? id) cfg);
      };
    in {
      system.activationScripts.shortcuts.text = lib.optionalString cfg.enable ''
        set -euo pipefail
        # Resolve the active console user and their HOME so we write the right plists
        console_user="$({ /usr/bin/stat -f%Su /dev/console 2>/dev/null; } || true)"
        if [ -z "''${console_user}" ] || [ "''${console_user}" = "root" ] || [ "''${console_user}" = "loginwindow" ]; then
          echo "[shortcuts] No active GUI user; skipping AppleSymbolicHotKeys activation"
          exit 0
        fi
        console_home="$({ /usr/bin/dscl . -read "/Users/''${console_user}" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}'; } || true)"
        if [ -z "''${console_home}" ]; then
          console_home="$(eval echo ~"''${console_user}")"
        fi

        # Robust logging to aid debugging even if darwin-rebuild suppresses stdout
        LOG_FILE_SYSTEM="/tmp/shortcuts-activation.log"
        LOG_USER_DIR="$console_home/Library/Logs"
        LOG_FILE_USER="$LOG_USER_DIR/shortcuts-activation.log"
        /bin/mkdir -p "$LOG_USER_DIR" 2>/dev/null || true
        # Fresh run: truncate the system log so post-activation summary reflects only this session
        : > "$LOG_FILE_SYSTEM"
        log() { echo "$*" | tee -a "$LOG_FILE_SYSTEM" | tee -a "$LOG_FILE_USER" >&2; }
        # High-level plan summary
        DESKTOPS_ENABLED_FLAG="${if kbCfg.spaces.directDesktopShortcuts.enable then "1" else ""}"
        SHIFT_DIGITS_FLAG="${if kbCfg.spaces.directDesktopShortcuts.useShiftForDigits then "1" else ""}"
        INPUT_HOTKEYS_DISABLED_FLAG="${if (kbCfg.disableInputSourceHotkeys or false) then "1" else ""}"
        TILING_ENABLED_FLAG="${if (kbCfg.tilingShortcuts.enable or false) then "1" else ""}"
        SPOTLIGHT_ENABLED_FLAG="${if (config.system.keyboard.shortcuts.spotlight.search.enable) then "1" else ""}"
        DESKTOPS_ENABLED=$([ -n "$DESKTOPS_ENABLED_FLAG" ] && echo true || echo false)
        SHIFT_DIGITS=$([ -n "$SHIFT_DIGITS_FLAG" ] && echo true || echo false)
        INPUT_HOTKEYS_DISABLED=$([ -n "$INPUT_HOTKEYS_DISABLED_FLAG" ] && echo true || echo false)
        TILING_ENABLED=$([ -n "$TILING_ENABLED_FLAG" ] && echo true || echo false)
        SPOTLIGHT_DISABLED=$([ -z "$SPOTLIGHT_ENABLED_FLAG" ] && echo true || echo false)
        DESKTOP_MODS_NAME=$([ -n "$SHIFT_DIGITS_FLAG" ] && echo "Ctrl+Shift" || echo "Ctrl")
        # Caps Lock -> Escape mapping present anywhere?
        CAPS_ESC="${if (
          let
            ms = if kbCfg.mappings or null == null then [] else (if builtins.isList kbCfg.mappings then kbCfg.mappings else [ kbCfg.mappings ]);
          in lib.any (m: (m.mappings or {}) ? "Keyboard Caps Lock" && (m.mappings."Keyboard Caps Lock" == "Keyboard Escape")) ms
        ) then "true" else "false"}"
        log "[shortcuts] config: desktops=$DESKTOPS_ENABLED (modifier=$DESKTOP_MODS_NAME) inputHotkeysDisabled=$INPUT_HOTKEYS_DISABLED spotlightDisabled=$SPOTLIGHT_DISABLED tiling=$TILING_ENABLED capsLock→escape=$CAPS_ESC"
        runu() { /usr/bin/sudo -u "$console_user" env HOME="$console_home" "$@"; }
        log "[shortcuts] Starting activation for AppleSymbolicHotKeys (user=$console_user home=$console_home)"

        # 1) Update on-disk plists for both user and currentHost (merge behavior)
        log "[shortcuts] Merging JSON spec into user plist"
        runu "${updateShortcuts}" "${shortcutsSpec}"
        HOST_DIR="$console_home/Library/Preferences/ByHost"
        if [ -d "$HOST_DIR" ]; then
          for file in "$HOST_DIR"/com.apple.symbolichotkeys.*.plist; do
            [ -e "$file" ] || continue
            log "[shortcuts] Merging JSON spec into host plist: $file"
            runu "${updateShortcuts}" "${shortcutsSpec}" "$file"
          done
        fi

        # 2) Also import via CFPreferences (defaults import) so UI and Dock see it immediately
        TMP_PLIST="$(/usr/bin/mktemp -t symhotkeys).plist"
        "${pkgs.writeScript "writeDomainPlist.py" ''
          #!${pkgs.python3.interpreter}
          import json, plistlib, sys
          spec_path = sys.argv[1]
          out_path = sys.argv[2]
          with open(spec_path, 'rb') as f:
            spec = json.load(f)
          root = { 'AppleSymbolicHotKeys': spec }
          with open(out_path, 'wb') as f:
            plistlib.dump(root, f)
        ''}" "${shortcutsSpec}" "$TMP_PLIST"
        # Generic domain
        log "[shortcuts] CFPreferences import (user domain) as $console_user"
        runu /usr/bin/defaults import com.apple.symbolichotkeys "$TMP_PLIST" || true
        # CurrentHost domain
        log "[shortcuts] CFPreferences import (currentHost)"
        runu /usr/bin/defaults -currentHost import com.apple.symbolichotkeys "$TMP_PLIST" || true

        # 3) Nudge preference caches and Dock/Mission Control
        log "[shortcuts] Restarting cfprefsd, Dock, SystemUIServer"
        /usr/bin/killall cfprefsd 2>/dev/null || true
        /usr/bin/killall Dock 2>/dev/null || true
        /usr/bin/killall SystemUIServer 2>/dev/null || true

        # Final nudge
        log "[shortcuts] activateSettings -u"
        /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u || true

        # 4) Hard-ensure Mission Control direct desktop shortcuts (118..126)
        # Some macOS versions only honor explicit per-key edits via PlistBuddy.
        pb=/usr/libexec/PlistBuddy
        CTRL=262144
        SHIFT=131072
        CTRL_SHIFT=$((CTRL + SHIFT))
        # Choose modifier combo for direct desktops based on configuration
        DESKTOP_MODS=$([ -n "$SHIFT_DIGITS_FLAG" ] && echo "$CTRL_SHIFT" || echo "$CTRL")
        log "[shortcuts] Ensuring per-key Mission Control entries (118..126) and Spotlight (64) in user and host plists"
        ensure_mc_key() {
          local file="$1" id="$2" kcode="$3"
          /usr/bin/touch "$file"
          $pb -c "Print :AppleSymbolicHotKeys" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys dict" "$file" || true
          $pb -c "Print :AppleSymbolicHotKeys:$id" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys:$id dict" "$file" || true
          if ! $pb -c "Set :AppleSymbolicHotKeys:$id:enabled true" "$file" 2>/dev/null; then
            $pb -c "Add :AppleSymbolicHotKeys:$id:enabled bool true" "$file" || true
          fi
          $pb -c "Print :AppleSymbolicHotKeys:$id:value" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys:$id:value dict" "$file" || true
          if ! $pb -c "Set :AppleSymbolicHotKeys:$id:value:type standard" "$file" 2>/dev/null; then
            $pb -c "Add :AppleSymbolicHotKeys:$id:value:type string standard" "$file" || true
          fi
          $pb -c "Delete :AppleSymbolicHotKeys:$id:value:parameters" "$file" >/dev/null 2>&1 || true
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters array" "$file"
          # Use ascii=0 and configured modifiers for digits
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:0 integer 0" "$file"
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:1 integer $kcode" "$file"
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:2 integer $DESKTOP_MODS" "$file"
        }

        ensure_spotlight_on() {
          local file="$1"
          local id=64 ascii=32 keycode=49 mods=1048576
          /usr/bin/touch "$file"
          $pb -c "Print :AppleSymbolicHotKeys" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys dict" "$file" || true
          $pb -c "Print :AppleSymbolicHotKeys:$id" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys:$id dict" "$file" || true
          if ! $pb -c "Set :AppleSymbolicHotKeys:$id:enabled true" "$file" 2>/dev/null; then
            $pb -c "Add :AppleSymbolicHotKeys:$id:enabled bool true" "$file" || true
          fi
          $pb -c "Print :AppleSymbolicHotKeys:$id:value" "$file" >/dev/null 2>&1 || $pb -c "Add :AppleSymbolicHotKeys:$id:value dict" "$file" || true
          if ! $pb -c "Set :AppleSymbolicHotKeys:$id:value:type standard" "$file" 2>/dev/null; then
            $pb -c "Add :AppleSymbolicHotKeys:$id:value:type string standard" "$file" || true
          fi
          $pb -c "Delete :AppleSymbolicHotKeys:$id:value:parameters" "$file" >/dev/null 2>&1 || true
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters array" "$file"
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:0 integer $ascii" "$file"
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:1 integer $keycode" "$file"
          $pb -c "Add :AppleSymbolicHotKeys:$id:value:parameters:2 integer $mods" "$file"
        }

        # Apply to user plist
        USER_PLIST="$console_home/Library/Preferences/com.apple.symbolichotkeys.plist"
        if [ -n "$DESKTOPS_ENABLED_FLAG" ]; then
          ensure_mc_key "$USER_PLIST" 118 18
          ensure_mc_key "$USER_PLIST" 119 19
          ensure_mc_key "$USER_PLIST" 120 20
          ensure_mc_key "$USER_PLIST" 121 21
          ensure_mc_key "$USER_PLIST" 122 23
          ensure_mc_key "$USER_PLIST" 123 22
          ensure_mc_key "$USER_PLIST" 124 26
          ensure_mc_key "$USER_PLIST" 125 28
          ensure_mc_key "$USER_PLIST" 126 25
        fi
        # Spotlight on if configured
        if [ "${toString config.system.keyboard.shortcuts.spotlight.search.enable}" = "true" ]; then
          ensure_spotlight_on "$USER_PLIST"
        fi

        # Apply to currentHost plists
        if [ -d "$HOST_DIR" ] && [ -n "$DESKTOPS_ENABLED_FLAG" ]; then
          for file in "$HOST_DIR"/com.apple.symbolichotkeys.*.plist; do
            [ -e "$file" ] || continue
            ensure_mc_key "$file" 118 18
            ensure_mc_key "$file" 119 19
            ensure_mc_key "$file" 120 20
            ensure_mc_key "$file" 121 21
            ensure_mc_key "$file" 122 23
            ensure_mc_key "$file" 123 22
            ensure_mc_key "$file" 124 26
            ensure_mc_key "$file" 125 28
            ensure_mc_key "$file" 126 25
          done
        fi
        if [ -d "$HOST_DIR" ] && [ -n "$SPOTLIGHT_ENABLED_FLAG" ]; then
          for file in "$HOST_DIR"/com.apple.symbolichotkeys.*.plist; do
            [ -e "$file" ] || continue
            ensure_spotlight_on "$file"
          done
        fi

        log "[shortcuts] Final restart of cfprefsd, Dock, SystemUIServer"
        /usr/bin/killall cfprefsd 2>/dev/null || true
        /usr/bin/killall Dock 2>/dev/null || true
        /usr/bin/killall SystemUIServer 2>/dev/null || true

        # 5) Summary of relevant keys (user + currentHost)
        summarize() {
          local scope=""; if [ $# -gt 0 ]; then scope="$1"; shift || true; fi
          # Avoid bash arrays to keep Nix interpolation simple
          if out="$(runu /usr/bin/defaults "$scope" read com.apple.symbolichotkeys AppleSymbolicHotKeys 2>/dev/null)"; then
            echo "$out" | /usr/bin/plutil -convert json - -o - |
              "${pkgs.jq}/bin/jq" -r '
                def name(k):
                  if k=="60" then "input-prev"
                  elif k=="61" then "input-next"
                  elif k=="79" then "space-left"
                  elif k=="80" then "space-right"
                  else ("desktop-" + ((k|tonumber) - 117 | tostring)) end;
                to_entries
                | map(select(.key | test("^(60|61|79|80|118|119|120|121|122|123|124|125|126)$")))
                | sort_by(.key|tonumber)
                | .[]
                | "[shortcuts] " + name(.key)
                  + " enabled=" + (.value.enabled|tostring)
                  + " params=" + ((.value.value.parameters // [])|tostring)
              '
          else
            log "[shortcuts] No com.apple.symbolichotkeys for scope $scope"
          fi
        }
        summarize | tee -a "$LOG_FILE_SYSTEM" "$LOG_FILE_USER" >/dev/null
        summarize -currentHost | tee -a "$LOG_FILE_SYSTEM" "$LOG_FILE_USER" >/dev/null
        log "[shortcuts] Activation complete"
      '';
      # Surface a concise summary into darwin-rebuild output even if stdout is muted
      system.activationScripts.postActivation.text = lib.mkAfter (lib.optionalString cfg.enable ''
        set -euo pipefail

        # Determine GUI user for reading user-domain prefs
        console_user="$({ /usr/bin/stat -f%Su /dev/console 2>/dev/null; } || true)"
        console_home="$({ /usr/bin/dscl . -read "/Users/''${console_user}" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}'; } || true)"
        [ -z "''${console_home}" ] && console_home="$(eval echo ~"''${console_user}")"

        # Print a concise, fresh summary (do not rely on previous logs)
        DESKTOPS_ENABLED="${toString kbCfg.spaces.directDesktopShortcuts.enable}"
        SHIFT_DIGITS="${toString kbCfg.spaces.directDesktopShortcuts.useShiftForDigits}"
        INPUT_HOTKEYS_DISABLED="${toString (kbCfg.disableInputSourceHotkeys or false)}"
        TILING_ENABLED="${toString (kbCfg.tilingShortcuts.enable or false)}"
        DESKTOP_MODS_NAME=$([ "$SHIFT_DIGITS" = "true" ] && echo "Ctrl+Shift" || echo "Ctrl")
        CAPS_ESC="${toString (
          let
            ms = if kbCfg.mappings or null == null then [] else (if builtins.isList kbCfg.mappings then kbCfg.mappings else [ kbCfg.mappings ]);
          in lib.any (m: (m.mappings or {}) ? "Keyboard Caps Lock" && (m.mappings."Keyboard Caps Lock" == "Keyboard Escape")) ms
        )}"
        echo "[shortcuts] config: desktops=$DESKTOPS_ENABLED (modifier=$DESKTOP_MODS_NAME) inputHotkeysDisabled=$INPUT_HOTKEYS_DISABLED tiling=$TILING_ENABLED capsLock→escape=$CAPS_ESC"

        summarize_scope() {
          local label="$1"; shift || true
          local scope="$1"; shift || true
          if out="$(/usr/bin/sudo -u "$console_user" env HOME="$console_home" /usr/bin/defaults "$scope" read com.apple.symbolichotkeys AppleSymbolicHotKeys 2>/dev/null)"; then
            echo "$out" | /usr/bin/plutil -convert json - -o - |
              "${pkgs.jq}/bin/jq" -r --arg label "$label" '
                def name(k):
                  if k=="60" then "input-prev"
                  elif k=="61" then "input-next"
                  elif k=="79" then "space-left"
                  elif k=="80" then "space-right"
                  elif k=="64" then "spotlight"
                  else ("desktop-" + ((k|tonumber) - 117 | tostring)) end;
                to_entries
                | map(select(.key | test("^(60|61|64|79|80|118|119|120|121|122|123|124|125|126)$")))
                | sort_by(.key|tonumber)
                | .[]
                | "[shortcuts] " + $label + " " + name(.key)
                  + " enabled=" + (.value.enabled|tostring)
                  + " params=" + ((.value.value.parameters // [])|tostring)
              '
          else
            echo "[shortcuts] $label: no com.apple.symbolichotkeys"
          fi
        }

        summarize_scope user ""
        summarize_scope currentHost -currentHost
      '');
      # No LaunchAgent is installed; activation performs a one-shot update.
    };
}
