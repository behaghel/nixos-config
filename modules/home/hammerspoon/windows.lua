local M = {}

function M.setup()
  local log = hs.logger.new("windows", "info")

  local function focusedStandardWindow()
    local win = hs.window.focusedWindow()
    if not win then return nil end
    if not win:isStandard() then return nil end
    if not win:screen() then return nil end
    return win
  end

  local function snapFocusedWindow(unitRect, label)
    local win = focusedStandardWindow()
    if not win then
      log.i("snap skipped: no focused standard window for " .. label)
      return
    end

    win:moveToUnit(unitRect)
  end

  local function maximizeFocusedWindow(label)
    local win = focusedStandardWindow()
    if not win then
      log.i("maximize skipped: no focused standard window for " .. label)
      return
    end

    win:maximize()
  end

  local function fullscreenFocusedWindow(label)
    local win = focusedStandardWindow()
    if not win then
      log.i("fullscreen skipped: no focused standard window for " .. label)
      return
    end

    win:setFullScreen(true)
  end

  local function bindSnapHotkey(mods, key, unitRect, label)
    local assigned = hs.hotkey.systemAssigned(mods, key)
    if assigned and assigned.enabled then
      log.w(string.format(
        "Skipping %s snap: %s+%s is system-assigned",
        label,
        table.concat(mods, "+"),
        key
      ))
      return
    end

    if not hs.hotkey.assignable(mods, key) then
      log.w(string.format(
        "Skipping %s snap: %s+%s is not assignable",
        label,
        table.concat(mods, "+"),
        key
      ))
      return
    end

    local hotkey = hs.hotkey.bind(mods, key, function()
      snapFocusedWindow(unitRect, label)
    end)

    if not hotkey then
      log.w(string.format(
        "Skipping %s snap: failed to bind %s+%s",
        label,
        table.concat(mods, "+"),
        key
      ))
    end
  end

  local function bindWindowHotkey(mods, key, label, action)
    local assigned = hs.hotkey.systemAssigned(mods, key)
    if assigned and assigned.enabled then
      log.w(string.format(
        "Skipping %s: %s+%s is system-assigned",
        label,
        table.concat(mods, "+"),
        key
      ))
      return
    end

    if not hs.hotkey.assignable(mods, key) then
      log.w(string.format(
        "Skipping %s: %s+%s is not assignable",
        label,
        table.concat(mods, "+"),
        key
      ))
      return
    end

    local hotkey = hs.hotkey.bind(mods, key, function()
      action(label)
    end)

    if not hotkey then
      log.w(string.format(
        "Skipping %s: failed to bind %s+%s",
        label,
        table.concat(mods, "+"),
        key
      ))
    end
  end

  -- BÉPO SHORTCUT: Cycle Windows in Same App
  -- Binds Cmd + $ (or your preferred key) to cycle windows
  local function cycleWindowsSameApp()
    local win = hs.window.focusedWindow()
    -- If no window is focused, do nothing
    if not win then return end

    local app = win:application()
    -- Get all windows of the active app
    local windows = app:allWindows()

    -- Standard macOS window lists are usually Z-ordered (1 is front, last is back).
    -- To cycle, grab the last window in the stack and bring it to the front.
    if #windows > 1 then
      windows[#windows]:focus()
    end
  end

  -- Bind symbol and keycodes for bépo on both ISO (external) and ANSI (built-in) keyboards.
  hs.hotkey.bind({ "cmd" }, "$", cycleWindowsSameApp)
  hs.hotkey.bind({ "cmd" }, 10, cycleWindowsSameApp)
  hs.hotkey.bind({ "cmd" }, 50, cycleWindowsSameApp)

  -- Fallback: intercept Cmd + "$" by character to catch any layout/hardware quirk.
  local cmdDollarTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(ev)
    local flags = ev:getFlags()
    local cmdOnly = flags.cmd and not (flags.alt or flags.ctrl or flags.fn or flags.hyper)
    if not cmdOnly then return false end
    local ch = ev:getCharacters(true)
    if ch == "$" then
      cycleWindowsSameApp()
      return true
    end
    return false
  end)
  cmdDollarTap:start()

  -- WINDOW SWITCHER (Alt+Tab style behavior)
  local switcher = hs.window.switcher.new(hs.window.filter.new())
  switcher.ui.showThumbnails = true
  switcher.ui.showSelectedThumbnail = true

  -- Command+Tab is owned by macOS and cannot be registered as a hotkey.
  local tabCode = hs.keycodes.map.tab
  local cmdTabTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(ev)
    if ev:getKeyCode() ~= tabCode then return false end
    local flags = ev:getFlags()
    local cmdOnly = flags.cmd and not (flags.alt or flags.ctrl or flags.fn or flags.hyper)
    if cmdOnly and flags.shift then
      switcher:previous()
      return true
    elseif cmdOnly then
      switcher:next()
      return true
    end
    return false
  end)
  cmdTabTap:start()

  local snapMods = { "cmd", "alt" }
  bindSnapHotkey(snapMods, "left", { 0.0, 0.0, 0.5, 1.0 }, "left half")
  bindSnapHotkey(snapMods, "right", { 0.5, 0.0, 0.5, 1.0 }, "right half")
  bindSnapHotkey(snapMods, "up", { 0.0, 0.0, 1.0, 0.5 }, "top half")
  bindSnapHotkey(snapMods, "down", { 0.0, 0.5, 1.0, 0.5 }, "bottom half")
  bindWindowHotkey(snapMods, "f", "maximize", maximizeFocusedWindow)
  bindWindowHotkey({ "cmd", "alt", "shift" }, "f", "fullscreen", fullscreenFocusedWindow)
end

return M
