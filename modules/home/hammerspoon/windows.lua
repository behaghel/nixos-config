local M = {}

function M.setup()
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
end

return M
