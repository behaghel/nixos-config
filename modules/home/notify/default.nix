{ pkgs, ... }:

let
  hubNotify = pkgs.writeShellApplication {
    name = "hub-notify";
    text = ''
      set -eu

      sound=""
      if [ "''${1-}" = "--sound" ]; then
        sound="''${2-}"
        shift 2
      fi

      title="''${1:-Notification}"
      message="''${2:-}"

      if [ "$(uname -s)" = "Darwin" ] && [ -x /usr/bin/osascript ]; then
        /usr/bin/osascript - "$title" "$message" "$sound" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set notificationTitle to item 1 of argv
  set notificationMessage to item 2 of argv
  set notificationSound to item 3 of argv

  if notificationSound is "" then
    display notification notificationMessage with title notificationTitle
  else
    display notification notificationMessage with title notificationTitle sound name notificationSound
  end if
end run
APPLESCRIPT
      elif command -v notify-send >/dev/null 2>&1; then
        notify-send "$title" "$message" >/dev/null 2>&1 || true
      fi
    '';
  };
in
{
  home.packages = [ hubNotify ];
}
