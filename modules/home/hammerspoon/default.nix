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
        run_screencapture({"-i", path}, path)
      end)

      -- Shift+Print Screen → main display → file + clipboard
      hs.hotkey.bind({"shift"}, "f13", function()
        local path = screenshotPath()
        run_screencapture({"-m", path}, path)
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
      -- draw.screens[screenId] = { canvas, origin, strokes, previewIds }
      -----------------------------------------------------------------------
      local drawLog = hs.logger.new("draw", "info")

      local EPHEMERAL_DELAY = 2   -- seconds before ephemeral strokes fade
      local FADE_DURATION  = 1.0 -- seconds for the fade-out animation
      local FADE_STEPS     = 20  -- number of alpha steps in the fade

      -- Cursor indicator constants
      -- Canvas layout: [1]=background, [2]=tool shape, [3]=ephemeral badge, [4+]=strokes
      local INDICATOR_TOOL_IDX  = 2
      local INDICATOR_EPH_IDX  = 3
      local INDICATOR_OFFSET_X  = 24  -- offset right of cursor
      local INDICATOR_OFFSET_Y  = 6   -- slight offset below cursor

      local draw = {
        active = false,
        tool = "pen", -- pen|rect|arrow
        ephemeralMode = false, -- when true, all strokes are ephemeral
        colorIndex = 1,
        colors = {
          { red = 1, green = 0.2, blue = 0.2, alpha = 0.9 },   -- red
          { red = 0.1, green = 0.6, blue = 1.0, alpha = 0.9 }, -- blue
          { red = 0.2, green = 1.0, blue = 0.4, alpha = 0.9 }, -- green
          { white = 1, alpha = 0.9 },                         -- white
        },
        width = 4,
        screens = {},   -- screenId -> { canvas, origin, strokes, previewIds, timers }
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

      -- Build the tool shape element at a given center
      local function makeToolElem(cx, cy, tool, color)
        if tool == "pen" then
          return {
            type = "circle",
            center = { x = cx, y = cy },
            radius = 4,
            action = "fill",
            fillColor = color,
          }
        elseif tool == "rect" then
          local half = 6
          return {
            type = "rectangle",
            action = "stroke",
            strokeColor = color,
            strokeWidth = 2,
            frame = { x = cx - half, y = cy - half, w = half * 2, h = half * 2 },
          }
        else -- arrow
          -- Small ">" chevron
          local sz = 6
          return {
            type = "segments",
            coordinates = {
              { x = cx - sz, y = cy - sz },
              { x = cx + sz, y = cy },
              { x = cx - sz, y = cy + sz },
            },
            action = "stroke",
            strokeColor = color,
            strokeWidth = 2.5,
          }
        end
      end

      -- Build the ephemeral badge element (small timer icon next to tool indicator)
      local function makeEphBadge(cx, cy, visible)
        return {
          type = "text",
          text = visible and "\u{23F1}" or "",  -- stopwatch emoji
          textSize = 12,
          textColor = { white = 1, alpha = 0.9 },
          frame = { x = cx + 10, y = cy - 14, w = 20, h = 20 },
        }
      end

      -- Move the indicator to follow the cursor (canvas-relative coords).
      -- Wrapped in pcall so a failure here never breaks the drawing callback.
      local function moveIndicator(scrState, cx, cy)
        pcall(function()
          scrState.canvas[INDICATOR_TOOL_IDX] = makeToolElem(cx, cy, draw.tool, currentColor())
          scrState.canvas[INDICATOR_EPH_IDX] = makeEphBadge(cx, cy, draw.ephemeralMode)
        end)
      end

      -- Show/hide the indicator (alpha toggle)
      local function setIndicatorVisible(scrState, visible)
        pcall(function()
          local color = currentColor()
          local rc = {}; for k,v in pairs(color) do rc[k]=v end
          rc.alpha = visible and (color.alpha or 0.9) or 0
          local tool = scrState.canvas[INDICATOR_TOOL_IDX]
          if tool then
            if tool.fillColor then tool.fillColor = rc end
            if tool.strokeColor then tool.strokeColor = rc end
            scrState.canvas[INDICATOR_TOOL_IDX] = tool
          end
        end)
      end

      -- Refresh indicator color/tool on all screen canvases
      local function refreshIndicatorOnAll()
        for _, state in pairs(draw.screens) do
          pcall(function()
            local c = state.canvas
            local tool = c[INDICATOR_TOOL_IDX]
            if tool then
              -- Preserve position from existing element
              local cx, cy = 0, 0
              if tool.center then cx, cy = tool.center.x, tool.center.y
              elseif tool.frame then cx, cy = tool.frame.x + tool.frame.w/2, tool.frame.y + tool.frame.h/2
              elseif tool.coordinates and tool.coordinates[2] then cx, cy = tool.coordinates[2].x, tool.coordinates[2].y
              end
              c[INDICATOR_TOOL_IDX] = makeToolElem(cx, cy, draw.tool, currentColor())
              c[INDICATOR_EPH_IDX] = makeEphBadge(cx, cy, draw.ephemeralMode)
            end
          end)
        end
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
        -- cursor indicator element (index 2) — initially off-screen
        c:insertElement(makeToolElem(-100, -100, draw.tool, currentColor()))
        -- ephemeral badge element (index 3) — initially off-screen
        c:insertElement(makeEphBadge(-100, -100, false))
        c:show()
        return {
          canvas = c,
          origin = { x = frame.x, y = frame.y },
          strokes = {},
          previewIds = {},
          timers = {},  -- strokeArrayIdx -> timer (for ephemeral auto-erase)
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

      -- Cancel all pending ephemeral timers for a screen state
      local function cancelTimers(state)
        for k, t in pairs(state.timers) do
          t:stop()
        end
        state.timers = {}
      end

      -- Delete all canvases
      local function deleteAllCanvases()
        for sid, state in pairs(draw.screens) do
          cancelTimers(state)
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
        if not s then return end
        -- Remove in reverse order so lower indices stay valid
        for i = #s.previewIds, 1, -1 do
          s.canvas:removeElement(s.previewIds[i])
        end
        s.previewIds = {}
      end

      local function addStroke(elem)
        local s = activeCanvas()
        if not s then return end
        s.canvas:insertElement(elem)
        table.insert(s.strokes, { #s.canvas })
      end

      -- Add multiple elements as a single undoable stroke (e.g., arrow shaft + head)
      local function addCompoundStroke(elems)
        local s = activeCanvas()
        if not s then return end
        local indices = {}
        for _, elem in ipairs(elems) do
          s.canvas:insertElement(elem)
          table.insert(indices, #s.canvas)
        end
        table.insert(s.strokes, indices)
      end

      -- Fade out canvas elements then remove them.
      -- elemIndices: array of canvas element indices (highest first is fine).
      -- onDone: called after all elements are removed.
      local function fadeAndRemove(scrState, elemIndices, onDone)
        if not scrState or not scrState.canvas then
          if onDone then onDone() end
          return
        end
        local step = 0
        local interval = FADE_DURATION / FADE_STEPS
        -- Read initial alpha from the first element's strokeColor (or fillColor)
        local initAlpha = 0.9
        local timer
        timer = hs.timer.doEvery(interval, function()
          step = step + 1
          local alpha = initAlpha * (1 - step / FADE_STEPS)
          if alpha < 0 then alpha = 0 end
          -- Update alpha on each element
          for _, eidx in ipairs(elemIndices) do
            local ok, _ = pcall(function()
              local e = scrState.canvas[eidx]
              if e then
                if e.strokeColor then
                  local c = {}; for k,v in pairs(e.strokeColor) do c[k]=v end
                  c.alpha = alpha
                  e.strokeColor = c
                  scrState.canvas[eidx] = e
                end
              end
            end)
          end
          if step >= FADE_STEPS then
            timer:stop()
            -- Remove elements in reverse index order so lower indices stay valid
            table.sort(elemIndices, function(a,b) return a > b end)
            for _, eidx in ipairs(elemIndices) do
              pcall(function() scrState.canvas:removeElement(eidx) end)
            end
            if onDone then onDone() end
          end
        end)
      end

      -- Schedule an ephemeral stroke for auto-erase after EPHEMERAL_DELAY seconds.
      -- strokeArrIdx: index into s.strokes (entry is an array of canvas indices).
      local function scheduleEphemeral(s, strokeArrIdx)
        local entry = s.strokes[strokeArrIdx]
        if not entry then return end
        s.timers[strokeArrIdx] = hs.timer.doAfter(EPHEMERAL_DELAY, function()
          s.timers[strokeArrIdx] = nil
          -- Fade all canvas elements in this stroke entry, then remove
          fadeAndRemove(s, entry, function()
            -- Find and remove this stroke entry
            for i, v in ipairs(s.strokes) do
              if v == entry then
                table.remove(s.strokes, i)
                -- Adjust timer keys that reference shifted stroke positions
                local newTimers = {}
                for k, t in pairs(s.timers) do
                  if k > i then
                    newTimers[k - 1] = t
                  elseif k < i then
                    newTimers[k] = t
                  end
                end
                s.timers = newTimers
                break
              end
            end
          end)
        end)
      end

      local function undoLast()
        -- Undo from the most-recently-drawn-on screen
        local s = activeCanvas()
        if not s then return end
        local strokeArrIdx = #s.strokes
        -- Cancel pending ephemeral timer if any
        if s.timers[strokeArrIdx] then
          s.timers[strokeArrIdx]:stop()
          s.timers[strokeArrIdx] = nil
        end
        local entry = table.remove(s.strokes)
        if not entry then return end
        -- entry is an array of canvas indices; remove in reverse order
        for i = #entry, 1, -1 do
          s.canvas:removeElement(entry[i])
        end
      end

      local function clearAll()
        for _, state in pairs(draw.screens) do
          cancelTimers(state)
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
            c:insertElement(makeToolElem(-100, -100, draw.tool, currentColor()))
            c:show()
            state.canvas = c
            state.strokes = {}
            state.previewIds = {}
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
        if #s.previewIds > 0 then
          s.canvas[s.previewIds[1]] = elem
        else
          s.canvas:insertElement(elem)
          s.previewIds = { #s.canvas }
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
        if #s.previewIds > 0 then
          s.canvas[s.previewIds[1]] = elem
        else
          s.canvas:insertElement(elem)
          s.previewIds = { #s.canvas }
        end
      end

      local function finalizeRect(current)
        if not activeStroke or not activeStroke.start then return end
        resetPreview()
        updateRectPreview(current)
        local s = activeCanvas()
        if s and #s.previewIds > 0 then
          -- Wrap preview indices as a single stroke entry
          local entry = {}
          for _, idx in ipairs(s.previewIds) do
            table.insert(entry, idx)
          end
          table.insert(s.strokes, entry)
          s.previewIds = {}
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
        s.previewIds = {}
        for _, elem in ipairs(elems) do
          s.canvas:insertElement(elem)
          table.insert(s.previewIds, #s.canvas)
        end
      end

      local function finalizeArrow(current)
        local start = activeStroke and activeStroke.start
        if not start then return end
        resetPreview()
        local elems = arrowElements(start, current, activeStroke.color)
        addCompoundStroke(elems)
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
          draw.ephemeralMode = false
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
          hs.eventtap.event.types.mouseMoved,
          hs.eventtap.event.types.leftMouseDown,
          hs.eventtap.event.types.leftMouseDragged,
          hs.eventtap.event.types.leftMouseUp,
        }

        local ok, tap = pcall(hs.eventtap.new, eventTypes, function(ev)
          if not draw.active then return false end
          local rawPt = ev:location()
          local evType = ev:getType()

          -- Let clicks in the menu bar region pass through (for tray menus, etc.)
          local pointScreen = hs.mouse.getCurrentScreen()
          if pointScreen then
            local full = pointScreen:fullFrame()
            local usable = pointScreen:frame()
            -- Menu bar occupies the gap between fullFrame top and frame top
            if rawPt.y < full.y + (usable.y - full.y) then
              return false
            end
          end

          -- Update cursor indicator on every mouse event
          if evType == hs.eventtap.event.types.mouseMoved
             or evType == hs.eventtap.event.types.leftMouseDragged then
            local sid = screenForPoint(rawPt)
            local s = sid and draw.screens[sid]
            if s then
              local loc = toCanvas(rawPt, s)
              moveIndicator(s, loc.x + INDICATOR_OFFSET_X,
                               loc.y + INDICATOR_OFFSET_Y)
            end
            -- mouseMoved: pass through (don't consume)
            if evType == hs.eventtap.event.types.mouseMoved then
              return false
            end
          end

          if evType == hs.eventtap.event.types.leftMouseDown then
            -- Detect which screen the click landed on
            local sid = screenForPoint(rawPt)
            draw.activeScr = sid
            local s = activeCanvas()
            if not s then return false end
            -- Hide indicator while drawing
            setIndicatorVisible(s, false)
            local loc = toCanvas(rawPt, s)
            activeStroke = {
              start = { x = loc.x, y = loc.y },
              points = { { x = loc.x, y = loc.y } },
              color = currentColor(),
              ephemeral = draw.ephemeralMode or ev:getFlags().shift or false,
            }
            resetPreview()
            return true

          elseif evType == hs.eventtap.event.types.leftMouseDragged then
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

          elseif evType == hs.eventtap.event.types.leftMouseUp then
            if not activeStroke then return true end
            local s = activeCanvas()
            if not s then return true end
            -- Show indicator again
            setIndicatorVisible(s, true)
            local loc = toCanvas(rawPt, s)
            local isEphemeral = activeStroke.ephemeral
            local strokesBefore = #s.strokes
            if draw.tool == "pen" then
              table.insert(activeStroke.points, { x = loc.x, y = loc.y })
              finalizePen()
            elseif draw.tool == "rect" then
              finalizeRect(loc)
            elseif draw.tool == "arrow" then
              finalizeArrow(loc)
            end
            resetPreview()
            -- Schedule auto-erase for ephemeral strokes (shift held at mouseDown)
            if isEphemeral then
              for i = strokesBefore + 1, #s.strokes do
                scheduleEphemeral(s, i)
              end
            end
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
        refreshIndicatorOnAll()
        updateMenu()
      end

      updateMenu = function()
        if not draw.menu then return end
        local active = draw.active
        local ephLabel = draw.ephemeralMode and " \u{23F1}" or ""
        draw.menu:setTitle(active and ("Draw \u{270F}\u{FE0F}" .. ephLabel) or "Draw")
        draw.menu:setMenu({
          { title = active and "Turn off" or "Turn on", fn = toggleOverlay },
          { title = "Tool: pen", fn = function() setTool("pen") end },
          { title = "Tool: rect", fn = function() setTool("rect") end },
          { title = "Tool: arrow", fn = function() setTool("arrow") end },
          { title = "Undo last", disabled = not active, fn = undoLast },
          { title = "Clear", disabled = not active, fn = clearAll },
          { title = "Next color", disabled = not active, fn = function() nextColor(); refreshIndicatorOnAll(); hs.alert.show("Color changed") end },
          { title = draw.ephemeralMode and "Ephemeral \u{2705}" or "Ephemeral", disabled = not active, fn = function() draw.ephemeralMode = not draw.ephemeralMode; refreshIndicatorOnAll(); updateMenu() end },
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
        if draw.active then nextColor(); refreshIndicatorOnAll(); hs.alert.show("Color changed"); updateMenu() end
      end)

      -- URL event handlers (Stream Deck via Elgato app "Open URL" actions)
      -- Usage: open -g "hammerspoon://drawon" (or drawoff, drawpen, etc.)
      hs.urlevent.bind("drawon", function()
        if not draw.active then toggleOverlay() end
      end)
      hs.urlevent.bind("drawoff", function()
        if draw.active then toggleOverlay() end
      end)
      hs.urlevent.bind("drawpen", function()
        if draw.active then setTool("pen"); updateMenu() end
      end)
      hs.urlevent.bind("drawrect", function()
        if draw.active then setTool("rect"); updateMenu() end
      end)
      hs.urlevent.bind("drawarrow", function()
        if draw.active then setTool("arrow"); updateMenu() end
      end)
      hs.urlevent.bind("drawundo", function()
        if draw.active then undoLast(); updateMenu() end
      end)
      hs.urlevent.bind("drawcolor", function()
        if draw.active then nextColor(); refreshIndicatorOnAll(); hs.alert.show("Color changed"); updateMenu() end
      end)
      hs.urlevent.bind("drawephemeral", function()
        draw.ephemeralMode = not draw.ephemeralMode
        refreshIndicatorOnAll()
        updateMenu()
        hs.alert.show(draw.ephemeralMode and "Ephemeral ON" or "Ephemeral OFF")
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
