{ lib, pkgs, ... }:
let
  cfg = import ../../darwin/keyboard/config.nix;
  tableBase = import ../../darwin/keyboard/hid-usage-table.nix;
  keyMappingTable = tableBase // {
    "Keyboard Left Function (fn)" = 1095216660483;
    "Keyboard Right Function (fn)" = 280379760050179;
  };

  mkUserKeyMapping = mapping:
    builtins.toJSON {
      UserKeyMapping = lib.mapAttrsToList
        (src: dst: {
          HIDKeyboardModifierMappingSrc = keyMappingTable.${src};
          HIDKeyboardModifierMappingDst = keyMappingTable.${dst};
        })
        mapping;
    };

  mkAgent = { vendorId, productId, mappings, ... }:
    let
      productIdHex = pkgs.runCommand "${toString productId}-to-hex-string" { } ''printf "%#0x" ${toString productId} > $out'';
      vendorIdHex = pkgs.runCommand "${toString vendorId}-to-hex-string" { } ''printf "%#0x" ${toString vendorId} > $out'';
      script = pkgs.writeScriptBin "apply-keybindings" ''
        #!${pkgs.stdenv.shell}
        set -euo pipefail

        retry() {
          local attempt=1 max_attempts=10 delay=0.2
          while true; do
            "$@" && break || {
              if [ $attempt -lt $max_attempts ]; then
                attempt=$((attempt + 1))
                sleep $delay
              else
                exit 1
              fi
            }
          done
        }

        get_vendor_id() {
          hidutil list --matching keyboard | awk '{ print $1 }' | grep $(<${vendorIdHex})
        }

        get_product_id() {
          hidutil list --matching keyboard | awk '{ print $2 }' | grep $(<${productIdHex})
        }

        internal_keyboard_present() {
          hidutil list --matching keyboard | grep -q 'Apple Internal Keyboard / Trackpad'
        }

        echo "$(date) applying keyboard mapping for product ${toString productId} ($(cat ${productIdHex}))" >&2
        retry get_vendor_id || true
        if retry get_product_id; then
          hidutil property --matching '${builtins.toJSON { ProductID = productId; }}' --set '${mkUserKeyMapping mappings}' >/dev/null
        else
          if internal_keyboard_present; then
            echo "Product/Vendor ID not reported; applying by Product name (internal keyboard)." >&2
            hidutil property --matching '{ "Product": "Apple Internal Keyboard / Trackpad" }' --set '${mkUserKeyMapping mappings}' >/dev/null
          else
            echo "WARNING: Could not identify target keyboard to apply mapping." >&2
            exit 0
          fi
        fi
      '';
    in
    {
      enable = true;
      config = {
        Label = "org.nixos.keyboard-${toString productId}";
        ProgramArguments = [ "${script}/bin/apply-keybindings" ];
        RunAtLoad = true;
        StartInterval = 15; # retry periodically to survive re-plugs
        StandardOutPath = "/tmp/keyboard-${toString productId}.log";
        StandardErrorPath = "/tmp/keyboard-${toString productId}.log";
      };
    };
in
lib.mkIf (pkgs.stdenv.isDarwin && (cfg.enableKeyMapping or false)) {
  launchd.agents = lib.listToAttrs (
    map (m: lib.nameValuePair "org.nixos.keyboard-${toString m.productId}" (mkAgent m)) cfg.mappings
  );
}
