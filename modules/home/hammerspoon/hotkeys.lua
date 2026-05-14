local M = {}

function M.setup()
  -- App focus hotkeys
  local bindings = {
    t = { name = "Ghostty" },
    -- Emacs can appear as "Emacs" or lower-case "emacs" depending on the build.
    e = { name = "Emacs", bundleID = "org.gnu.Emacs", altNames = { "emacs" } },
    f = { name = "Firefox" },
    v = { name = "VLC" },
    s = { name = "Slack" },
  }

  local function focusOrLaunch(entry)
    -- Try multiple identifiers before launching to avoid spawning another instance.
    local function findRunning()
      if entry.bundleID then
        local app = hs.application.get(entry.bundleID)
        if app then return app end
      end
      if entry.altNames then
        for _, n in ipairs(entry.altNames) do
          local app = hs.application.find(n)
          if app then return app end
        end
      end
      return hs.application.find(entry.name)
    end

    local app = findRunning()
    if app then
      app:activate(true)
      local win = app:mainWindow()
      if win then win:focus() end
      return
    end

    if entry.bundleID and hs.application.launchOrFocusByBundleID then
      hs.application.launchOrFocusByBundleID(entry.bundleID)
    else
      hs.application.launchOrFocus(entry.name)
    end

    app = findRunning()
    if app then
      app:activate(true)
      local win = app:mainWindow()
      if win then win:focus() end
    end
  end

  for key, entry in pairs(bindings) do
    hs.hotkey.bind({ "ctrl", "alt", "cmd" }, key, function()
      focusOrLaunch(entry)
      hs.alert.show("→ " .. entry.name, 0.5)
    end)
  end

  -- Screenshots: map Print Screen (F13) to capture → file + clipboard
  local function screenshotPath()
    return os.getenv("HOME") .. "/Desktop/Screenshot-"
      .. os.date("%Y-%m-%d_%H-%M-%S") .. ".png"
  end

  -- Run screencapture; on success copy the file to clipboard too
  local function run_screencapture(args, path)
    hs.task.new("/usr/sbin/screencapture", function(exitCode)
      if exitCode ~= 0 then return end
      local img = hs.image.imageFromPath(path)
      if img then
        hs.pasteboard.writeObjects(img)
        hs.alert.show("Saved + copied", 0.3)
      else
        hs.alert.show("Saved (clipboard failed)", 0.5)
      end
    end, args):start()
  end

  -- Print Screen → interactive region → file + clipboard
  hs.hotkey.bind({}, "f13", function()
    local path = screenshotPath()
    run_screencapture({ "-i", path }, path)
  end)

  -- Shift+Print Screen → main display → file + clipboard
  hs.hotkey.bind({ "shift" }, "f13", function()
    local path = screenshotPath()
    run_screencapture({ "-m", path }, path)
  end)

  -- Quick reload: Ctrl+Alt+Cmd+Shift+R
  hs.hotkey.bind({ "ctrl", "alt", "cmd", "shift" }, "r", function()
    hs.reload()
    hs.alert.show("Hammerspoon reloaded")
  end)

  -- Webcam background quick toggle: Ctrl+Alt+Cmd+B
  -- Adjust the names below if your menu bar item/process differs.
  local webcamBg = {
    process = "Logitech Camera Settings", -- menu bar app process name
    statusDesc = "Webcam", -- description/title substring of the status item (used to find the icon)
    cameraName = "Logitech Webcam C930e", -- camera entry in the menu
    backgroundMenu = { "Background", "Green" }, -- path: parent menu label, then entry
    hotkey = { "ctrl", "alt", "cmd" },
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
      hs.alert.show("Webcam background → " .. cfg.backgroundMenu[2], 0.8)
    else
      hs.alert.show("Webcam toggle failed: " .. (result or "unknown"), 1.5)
    end
  end

  hs.hotkey.bind(webcamBg.hotkey, webcamBg.hotkeyKey, function()
    setWebcamBackground(webcamBg)
  end)
end

return M
