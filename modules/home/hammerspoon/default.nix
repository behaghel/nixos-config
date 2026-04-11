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
        hs.hotkey.bind({"ctrl","alt","cmd"}, key, function()
          focusOrLaunch(entry)
          hs.alert.show("→ " .. entry.name, 0.5)
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
      local function cycleWindowsSameApp()
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
      end

      -- Bind symbol and keycodes for bépo on both ISO (external) and ANSI (built-in) keyboards.
      hs.hotkey.bind({"cmd"}, "$", cycleWindowsSameApp) -- layout-resolved (ISO → keycode 10 on bépo)
      hs.hotkey.bind({"cmd"}, 10, cycleWindowsSameApp)   -- explicit ISO keycode
      hs.hotkey.bind({"cmd"}, 50, cycleWindowsSameApp)   -- explicit ANSI keycode

      -- Fallback: intercept Cmd + "$" by character to catch any layout/hardware quirk.
      local cmdDollarTap = hs.eventtap.new({hs.eventtap.event.types.keyDown}, function(ev)
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
      -- Defines a filter that shows windows from all apps
      local switcher = hs.window.switcher.new(hs.window.filter.new())

      -- Optional: Customize the look (remove thumbnails for speed, etc.)
      switcher.ui.showThumbnails = true
      switcher.ui.showSelectedThumbnail = true

      -- Command+Tab is owned by macOS and cannot be registered as a hotkey; use
      -- an event tap instead to avoid "already registered" errors while still
      -- providing the custom switcher.
      local tabCode = hs.keycodes.map.tab
      local cmdTabTap = hs.eventtap.new({hs.eventtap.event.types.keyDown}, function(ev)
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

      -----------------------------------------------------------------------
      -- DRAW OVERLAY (SCREEN ANNOTATIONS)
      -- Architecture: one hs.canvas per screen (proven hhann pattern).
      -- draw.screens[screenId] = { canvas, origin, strokes, previewId }
      -----------------------------------------------------------------------
      local drawLog = hs.logger.new("draw", "info")

      local draw = {
        active = false,
        tool = "pen", -- pen|rect|arrow
        colorIndex = 1,
        colors = {
          { red = 1, green = 0.2, blue = 0.2, alpha = 0.9 },   -- red
          { red = 0.1, green = 0.6, blue = 1.0, alpha = 0.9 }, -- blue
          { red = 0.2, green = 1.0, blue = 0.4, alpha = 0.9 }, -- green
          { white = 1, alpha = 0.9 },                         -- white
        },
        width = 4,
        screens = {},   -- screenId -> { canvas, origin, strokes, previewId }
        activeScr = nil, -- screenId of the screen being drawn on
        taps = {},
        menu = nil,
      }

      local function currentColor()
        return draw.colors[draw.colorIndex]
      end

      local function nextColor()
        draw.colorIndex = draw.colorIndex % #draw.colors + 1
      end

      -- Get the per-screen state for the currently active drawing screen
      local function activeCanvas()
        return draw.screens[draw.activeScr]
      end

      -- Translate screen-absolute point to canvas-relative for a given screen state
      local function toCanvas(screenPt, scrState)
        local o = scrState.origin
        return { x = screenPt.x - o.x, y = screenPt.y - o.y }
      end

      -- Create one canvas for a single screen, return its state table
      local function createScreenCanvas(screen)
        local frame = screen:fullFrame()
        local sid = screen:id()
        drawLog.i("Creating canvas for screen", sid, hs.inspect(frame))
        local ok, c = pcall(function()
          return hs.canvas.new(frame)
            :level(hs.canvas.windowLevels.overlay)
            :behavior({"canJoinAllSpaces","transient"})
            :clickActivating(false)
        end)
        if not ok or not c then
          drawLog.e("Failed to create canvas for screen", sid, ":", c)
          return nil
        end
        -- transparent background element (index 1) to fill the screen
        c[1] = { type = "rectangle", action = "fill", fillColor = { alpha = 0 } }
        c:show()
        return {
          canvas = c,
          origin = { x = frame.x, y = frame.y },
          strokes = {},
          previewId = nil,
        }
      end

      -- Create canvases for all connected screens
      local function createAllCanvases()
        for _, screen in ipairs(hs.screen.allScreens()) do
          local sid = screen:id()
          if not draw.screens[sid] then
            local state = createScreenCanvas(screen)
            if state then draw.screens[sid] = state end
          end
        end
      end

      -- Delete all canvases
      local function deleteAllCanvases()
        for sid, state in pairs(draw.screens) do
          if state.canvas then state.canvas:delete() end
        end
        draw.screens = {}
        draw.activeScr = nil
      end

      -- Detect which screen contains a screen-absolute point
      local function screenForPoint(pt)
        for _, screen in ipairs(hs.screen.allScreens()) do
          local f = screen:fullFrame()
          if pt.x >= f.x and pt.x < f.x + f.w and
             pt.y >= f.y and pt.y < f.y + f.h then
            return screen:id()
          end
        end
        -- Fallback: primary screen
        local primary = hs.screen.primaryScreen()
        return primary and primary:id()
      end

      -- Preview / stroke helpers — operate on the active screen's canvas
      local function resetPreview()
        local s = activeCanvas()
        if s and s.previewId then
          s.canvas:removeElement(s.previewId)
          s.previewId = nil
        end
      end

      local function addStroke(elem)
        local s = activeCanvas()
        if not s then return end
        s.canvas:insertElement(elem)
        table.insert(s.strokes, #s.canvas)
      end

      local function undoLast()
        -- Undo from the most-recently-drawn-on screen
        local s = activeCanvas()
        if not s then return end
        local idx = table.remove(s.strokes)
        if idx then s.canvas:removeElement(idx) end
      end

      local function clearAll()
        for _, state in pairs(draw.screens) do
          -- Delete and recreate each canvas to reset cleanly
          local frame = state.canvas:frame()
          state.canvas:delete()
          local ok, c = pcall(function()
            return hs.canvas.new({
                x = state.origin.x, y = state.origin.y,
                w = frame.w, h = frame.h,
              })
              :level(hs.canvas.windowLevels.overlay)
              :behavior({"canJoinAllSpaces","transient"})
              :clickActivating(false)
          end)
          if ok and c then
            c[1] = { type = "rectangle", action = "fill", fillColor = { alpha = 0 } }
            c:show()
            state.canvas = c
            state.strokes = {}
            state.previewId = nil
          end
        end
      end

      local activeStroke = nil
      local updateMenu -- forward declaration (used by teardown/toggleOverlay/setTool)

      local function finalizePen()
        if not activeStroke or not activeStroke.points then return end
        resetPreview()
        addStroke({
          type = "segments",
          coordinates = activeStroke.points,
          action = "stroke",
          strokeColor = activeStroke.color,
          strokeWidth = draw.width,
        })
        activeStroke = nil
      end

      local function updatePenPreview()
        if not activeStroke or not activeStroke.points then return end
        local s = activeCanvas()
        if not s then return end
        local elem = {
          type = "segments",
          coordinates = activeStroke.points,
          action = "stroke",
          strokeColor = activeStroke.color,
          strokeWidth = draw.width,
        }
        if s.previewId then
          s.canvas[s.previewId] = elem
        else
          s.canvas:insertElement(elem)
          s.previewId = #s.canvas
        end
      end

      local function updateRectPreview(current)
        local start = activeStroke and activeStroke.start
        if not start then return end
        local s = activeCanvas()
        if not s then return end
        local x = math.min(start.x, current.x)
        local y = math.min(start.y, current.y)
        local w = math.abs(current.x - start.x)
        local h = math.abs(current.y - start.y)
        local elem = {
          type = "rectangle",
          action = "stroke",
          strokeColor = activeStroke.color,
          strokeWidth = draw.width,
          frame = { x = x, y = y, w = w, h = h },
        }
        if s.previewId then
          s.canvas[s.previewId] = elem
        else
          s.canvas:insertElement(elem)
          s.previewId = #s.canvas
        end
      end

      local function finalizeRect(current)
        if not activeStroke or not activeStroke.start then return end
        resetPreview()
        updateRectPreview(current)
        local s = activeCanvas()
        if s and s.previewId then
          table.insert(s.strokes, s.previewId)
          s.previewId = nil
        end
        activeStroke = nil
      end

      local function arrowElements(start, finish, color)
        local dx, dy = finish.x - start.x, finish.y - start.y
        local len = math.sqrt(dx * dx + dy * dy)
        if len < 2 then return {} end
        local normX, normY = dx / len, dy / len
        local headLen = math.min(18, len * 0.25)
        local backX, backY = finish.x - normX * headLen, finish.y - normY * headLen
        local perpX, perpY = -normY, normX
        local wing = headLen * 0.45
        local left = { x = backX + perpX * wing, y = backY + perpY * wing }
        local right = { x = backX - perpX * wing, y = backY - perpY * wing }
        return {
          {
            type = "segments",
            coordinates = { start, finish },
            action = "stroke",
            strokeColor = color,
            strokeWidth = draw.width,
          },
          {
            type = "segments",
            coordinates = { finish, left, finish, right },
            action = "stroke",
            strokeColor = color,
            strokeWidth = draw.width,
          }
        }
      end

      local function updateArrowPreview(current)
        local start = activeStroke and activeStroke.start
        if not start then return end
        local s = activeCanvas()
        if not s then return end
        local elems = arrowElements(start, current, activeStroke.color)
        resetPreview()
        for _, elem in ipairs(elems) do
          s.canvas:insertElement(elem)
          s.previewId = #s.canvas
        end
      end

      local function finalizeArrow(current)
        local start = activeStroke and activeStroke.start
        if not start then return end
        resetPreview()
        local elems = arrowElements(start, current, activeStroke.color)
        for _, elem in ipairs(elems) do
          addStroke(elem)
        end
        activeStroke = nil
      end

      local function teardown()
        draw.active = false
        resetPreview()
        activeStroke = nil
        for _, tap in ipairs(draw.taps) do
          tap:stop()
        end
        draw.taps = {}
        deleteAllCanvases()
        hs.alert.show("Draw overlay off", 0.6)
        updateMenu()
      end

      local function toggleOverlay()
        if draw.active then
          teardown()
          return
        end

        createAllCanvases()
        local anyCanvas = next(draw.screens) ~= nil
        if not anyCanvas then
          drawLog.e("toggleOverlay: no canvases created, aborting")
          hs.alert.show("Draw: canvas failed — check console", 2)
          return
        end
        draw.active = true
        hs.alert.show("Draw overlay on (" .. draw.tool .. ")", 0.6)
        updateMenu()

        local eventTypes = {
          hs.eventtap.event.types.leftMouseDown,
          hs.eventtap.event.types.leftMouseDragged,
          hs.eventtap.event.types.leftMouseUp,
        }

        local ok, tap = pcall(hs.eventtap.new, eventTypes, function(ev)
          if not draw.active then return false end
          local rawPt = ev:location()

          if ev:getType() == hs.eventtap.event.types.leftMouseDown then
            -- Detect which screen the click landed on
            local sid = screenForPoint(rawPt)
            draw.activeScr = sid
            local s = activeCanvas()
            if not s then return false end
            local loc = toCanvas(rawPt, s)
            activeStroke = {
              start = { x = loc.x, y = loc.y },
              points = { { x = loc.x, y = loc.y } },
              color = currentColor(),
            }
            resetPreview()
            return true

          elseif ev:getType() == hs.eventtap.event.types.leftMouseDragged then
            if not activeStroke then return true end
            local s = activeCanvas()
            if not s then return true end
            local loc = toCanvas(rawPt, s)
            if draw.tool == "pen" then
              table.insert(activeStroke.points, { x = loc.x, y = loc.y })
              updatePenPreview()
            elseif draw.tool == "rect" then
              updateRectPreview(loc)
            elseif draw.tool == "arrow" then
              updateArrowPreview(loc)
            end
            return true

          elseif ev:getType() == hs.eventtap.event.types.leftMouseUp then
            if not activeStroke then return true end
            local s = activeCanvas()
            if not s then return true end
            local loc = toCanvas(rawPt, s)
            if draw.tool == "pen" then
              table.insert(activeStroke.points, { x = loc.x, y = loc.y })
              finalizePen()
            elseif draw.tool == "rect" then
              finalizeRect(loc)
            elseif draw.tool == "arrow" then
              finalizeArrow(loc)
            end
            resetPreview()
            activeStroke = nil
            return true
          end
          return false
        end)
        if not ok or not tap then
          drawLog.e("Failed to create eventtap:", tap)
          hs.alert.show("Draw: eventtap failed — check console", 2)
          teardown()
          return
        end
        tap:start()
        table.insert(draw.taps, tap)
      end

      local function setTool(tool)
        draw.tool = tool
        hs.alert.show("Tool: " .. tool)
        updateMenu()
      end

      updateMenu = function()
        if not draw.menu then return end
        local active = draw.active
        draw.menu:setTitle(active and "Draw ✏️" or "Draw")
        draw.menu:setMenu({
          { title = active and "Turn off" or "Turn on", fn = toggleOverlay },
          { title = "Tool: pen", fn = function() setTool("pen") end },
          { title = "Tool: rect", fn = function() setTool("rect") end },
          { title = "Tool: arrow", fn = function() setTool("arrow") end },
          { title = "Undo last", disabled = not active, fn = undoLast },
          { title = "Clear", disabled = not active, fn = clearAll },
          { title = "Next color", disabled = not active, fn = function() nextColor(); hs.alert.show("Color changed") end },
        })
      end

      -- HOTKEYS
      hs.hotkey.bind({"ctrl","alt","cmd"}, "d", toggleOverlay)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "p", function()
        setTool("pen")
        updateMenu()
      end)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "r", function()
        setTool("rect")
        updateMenu()
      end)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "a", function()
        setTool("arrow")
        updateMenu()
      end)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "c", function()
        if draw.active then clearAll(); updateMenu() end
      end)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "z", function()
        if draw.active then undoLast(); updateMenu() end
      end)
      hs.hotkey.bind({"ctrl","alt","cmd"}, "x", function()
        if draw.active then nextColor(); hs.alert.show("Color changed"); updateMenu() end
      end)

      -- Menu bar toggle for draw overlay
      draw.menu = hs.menubar.new()
      updateMenu()
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
