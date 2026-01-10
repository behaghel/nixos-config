{ config, lib, pkgs, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
in
{
  config = lib.mkIf isDarwin {
    # Basic Hammerspoon config to focus apps with Ctrl+Alt+Cmd chords.
    home.file.".hammerspoon/init.lua".text = ''
      -- App focus hotkeys
      local bindings = {
        t = "Ghostty",
        e = "Emacs",
        f = "Firefox",
        v = "VLC",
        s = "Slack",
      }

      for key, appName in pairs(bindings) do
        hs.hotkey.bind({"ctrl","alt","cmd"}, key, function()
          hs.application.launchOrFocus(appName)
          local app = hs.appfinder.appFromName(appName)
          if app then app:activate(true) end
          hs.alert.show("→ " .. appName, 0.5)
        end)
      end

      -- Screenshots: map Print Screen (F13) combos to clipboard captures
      local function run_screencapture(args, label)
        hs.task.new("/usr/sbin/screencapture", function() end, args):start()
        if label then hs.alert.show(label, 0.3) end
      end

      -- Print Screen → interactive region to clipboard (Cmd+Ctrl+Shift+( in bépo)
      hs.hotkey.bind({}, "f13", function()
        run_screencapture({"-i", "-c"}, "Capture → clipboard")
      end)

      -- Shift+Print Screen → main display to clipboard (Cmd+Ctrl+Shift+» in bépo)
      hs.hotkey.bind({"shift"}, "f13", function()
        run_screencapture({"-m", "-c"}, "Full screen → clipboard")
      end)

      -- Quick reload: Ctrl+Alt+Cmd+Shift+R
      hs.hotkey.bind({"ctrl","alt","cmd","shift"}, "r", function()
        hs.reload()
        hs.alert.show("Hammerspoon reloaded")
      end)

      -- Webcam background quick toggle: Ctrl+Alt+Cmd+B
      -- Adjust the names below if your menu bar item/process differs.
      local webcamBg = {
        process = "Logitech Camera Settings",    -- menu bar app process name
        statusDesc = "Webcam",                   -- description/title substring of the status item (used to find the icon)
        cameraName = "Logitech Webcam C930e",    -- camera entry in the menu
        backgroundMenu = { "Background", "Green" }, -- path: parent menu label, then entry
        hotkey = {"ctrl","alt","cmd"},
        hotkeyKey = "b",
      }

      local function setWebcamBackground(cfg)
        local script = [[
          on run {procName, statusDesc, camName, bgParent, bgColor}
            tell application "System Events"
              if not (exists process procName) then return "process-missing" end if
              tell process procName
                try
                  set theItem to first menu bar item of menu bar 1 whose description contains statusDesc
                on error
                  try
                    set theItem to first menu bar item of menu bar 1 whose title contains statusDesc
                  on error
                    return "menubar-missing"
                  end try
                end try
                click theItem
                tell menu 1 of theItem
                  click menu item camName
                  click menu item bgParent
                  click menu item bgColor
                end tell
              end tell
            end tell
            return "ok"
          end run
        ]]
        local ok, result = hs.osascript.applescript(script, {
          cfg.process, cfg.statusDesc, cfg.cameraName,
          cfg.backgroundMenu[1], cfg.backgroundMenu[2],
        })
        if ok and result == "ok" then
          hs.alert.show("Webcam background → "..cfg.backgroundMenu[2], 0.8)
        else
          hs.alert.show("Webcam toggle failed: "..(result or "unknown"), 1.5)
        end
      end

      hs.hotkey.bind(webcamBg.hotkey, webcamBg.hotkeyKey, function()
        setWebcamBackground(webcamBg)
      end)

      hs.alert.show("Hammerspoon ready", 0.3)

      -- Mail sync menubar (Darwin): lightweight status + actions
      -- Requires hub.mail.enable = true and status file support.
      do
        local statusFile = "${config.hub.mail.statusFile or (config.home.homeDirectory + "/.cache/mail-sync/status.json")}"
        local logFile = "${config.home.homeDirectory}/Library/Logs/mail-sync.log"
        local icon_ok = "📭"        -- healthy, no fetch pending
        local icon_fetch = "⏳"     -- fetching
        local icon_fail = "⚠️"       -- failed/unhealthy
        local icon_unread = "📬"    -- healthy + unread (if used)
        local m = hs.menubar.new()
        local last = { state = "unknown", last_success = 0, last_attempt = 0 }

        local function read_file(path)
          local f = io.open(path, "r"); if not f then return nil end
          local c = f:read("*a"); f:close(); return c
        end

        local function read_status()
          local raw = read_file(statusFile)
          if not raw or #raw == 0 then return nil end
          local ok, dec = pcall(hs.json.decode, raw)
          if ok then return dec else return nil end
        end

        local function set_icon(st)
          local s = st and st.state or "unknown"
          local sym = icon_ok
          if s == "fetching" then sym = icon_fetch
          elseif s == "failed" then sym = icon_fail
          elseif s == "ok_unread" then sym = icon_unread
          elseif s == "ok" then sym = icon_ok
          else sym = icon_ok end
          m:setTitle(sym)
        end

        local function fetch_now()
          hs.task.new("/bin/zsh", nil, {"-lc", "MAIL_SYNC_WAIT=1 mail-sync"}):start()
        end

        local function restart_service()
          local uid = hs.execute("/usr/bin/id -u"):gsub("\n$","")
          hs.task.new("/bin/launchctl", nil, {"kickstart","-k","gui/"..uid.."/org.nixos.mail-sync"}):start()
        end

        local function show_logs()
          hs.task.new("/usr/bin/open", nil, {logFile}):start()
        end

        local function refresh()
          local st = read_status()
          if st then last = st end
          set_icon(last)
          local state = last.state or "unknown"
          local ls = last.last_success or 0
          local la = last.last_attempt or 0
          local menu = {
            { title = "Mail sync: "..state, disabled = true },
            { title = string.format("Last success: %s", ls == 0 and "n/a" or os.date("%c", ls)), disabled = false },
            { title = string.format("Last attempt: %s", la == 0 and "n/a" or os.date("%c", la)), disabled = false },
            { title = "-" },
            { title = "Fetch now", fn = fetch_now },
            { title = "Restart service", fn = restart_service },
            { title = "Show logs", fn = show_logs },
          }
          m:setMenu(menu)
        end

        if m then
          refresh()
          hs.timer.doEvery(30, refresh)
        end
      end

      -- BÉPO SHORTCUT: Cycle Windows in Same App
      -- Binds Cmd + $ (or your preferred key) to cycle windows
      hs.hotkey.bind({"cmd"}, "$", function()
          local win = hs.window.focusedWindow()
          -- If no window is focused, do nothing
          if not win then return end

          local app = win:application()
          -- Get all windows of the active app
          -- standardWindows() filters out weird invisible windows/tooltips
          local windows = app:allWindows()

          -- Logic: Standard macOS window lists are usually "Z-ordered" (1 is front, last is back).
          -- To cycle, we grab the LAST window in the stack (the one buried deepest)
          -- and bring it to the front. This creates a perfect loop A->B->C->A.
          if #windows > 1 then
              windows[#windows]:focus()
          end
      end)

      -- WINDOW SWITCHER (Alt+Tab style behavior)
      -- Defines a filter that shows windows from all apps
      local switcher = hs.window.switcher.new(hs.window.filter.new())

      -- Optional: Customize the look (remove thumbnails for speed, etc.)
      switcher.ui.showThumbnails = true
      switcher.ui.showSelectedThumbnail = true

      -- Bind Command+Tab to this new switcher
      hs.hotkey.bind({"cmd"}, "tab", function()
          switcher:next()
      end)

      -- Bind Command+Shift+Tab to cycle backwards
      hs.hotkey.bind({"cmd", "shift"}, "tab", function()
          switcher:previous()
      end)
    '';

    # Ensure Hammerspoon launches at login for the GUI session.
    launchd.agents.hammerspoon = {
      enable = true;
      config = {
        Label = "org.nixos.hammerspoon";
        ProgramArguments = [
          "/bin/sh"
          "-lc"
          ''
            # Launch quietly if installed; ignore failures if missing.
            /usr/bin/open -gj -a "Hammerspoon" || true
          ''
        ];
        RunAtLoad = true;
        KeepAlive = false;
        StandardOutPath = "${config.home.homeDirectory}/Library/Logs/hammerspoon-launch.log";
        StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/hammerspoon-launch.log";
      };
    };
  };
}
