local M = {}

function M.setup()
  -----------------------------------------------------------------------
  -- DRAW OVERLAY (SCREEN ANNOTATIONS)
  -- Architecture: one hs.canvas per screen.
  -----------------------------------------------------------------------
  local drawLog = hs.logger.new("draw", "info")

  local EPHEMERAL_DELAY = 2   -- seconds before ephemeral strokes fade
  local FADE_DURATION  = 1.0 -- seconds for the fade-out animation
  local FADE_STEPS     = 20  -- number of alpha steps in the fade

  -- Cursor indicator constants
  -- Canvas layout: [1]=background, [2]=tool shape, [3]=ephemeral badge, [4+]=strokes
  local INDICATOR_TOOL_IDX = 2
  local INDICATOR_EPH_IDX = 3
  local INDICATOR_OFFSET_X = 24
  local INDICATOR_OFFSET_Y = 6

  local draw = {
    active = false,
    tool = "pen", -- pen|rect|arrow
    ephemeralMode = false,
    colorIndex = 1,
    colors = {
      { red = 1, green = 0.2, blue = 0.2, alpha = 0.9 },
      { red = 0.1, green = 0.6, blue = 1.0, alpha = 0.9 },
      { red = 0.2, green = 1.0, blue = 0.4, alpha = 0.9 },
      { white = 1, alpha = 0.9 },
    },
    width = 4,
    screens = {},
    activeScr = nil,
    taps = {},
    menu = nil,
  }

  local function currentColor()
    return draw.colors[draw.colorIndex]
  end

  local function nextColor()
    draw.colorIndex = draw.colorIndex % #draw.colors + 1
  end

  local function activeCanvas()
    return draw.screens[draw.activeScr]
  end

  local function toCanvas(screenPt, scrState)
    local o = scrState.origin
    return { x = screenPt.x - o.x, y = screenPt.y - o.y }
  end

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
    else
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

  local function makeEphBadge(cx, cy, visible)
    return {
      type = "text",
      text = visible and "\u{23F1}" or "",
      textSize = 12,
      textColor = { white = 1, alpha = 0.9 },
      frame = { x = cx + 10, y = cy - 14, w = 20, h = 20 },
    }
  end

  local function moveIndicator(scrState, cx, cy)
    pcall(function()
      scrState.canvas[INDICATOR_TOOL_IDX] = makeToolElem(cx, cy, draw.tool, currentColor())
      scrState.canvas[INDICATOR_EPH_IDX] = makeEphBadge(cx, cy, draw.ephemeralMode)
    end)
  end

  local function setIndicatorVisible(scrState, visible)
    pcall(function()
      local color = currentColor()
      local rc = {}
      for k, v in pairs(color) do rc[k] = v end
      rc.alpha = visible and (color.alpha or 0.9) or 0
      local tool = scrState.canvas[INDICATOR_TOOL_IDX]
      if tool then
        if tool.fillColor then tool.fillColor = rc end
        if tool.strokeColor then tool.strokeColor = rc end
        scrState.canvas[INDICATOR_TOOL_IDX] = tool
      end
    end)
  end

  local function refreshIndicatorOnAll()
    for _, state in pairs(draw.screens) do
      pcall(function()
        local c = state.canvas
        local tool = c[INDICATOR_TOOL_IDX]
        if tool then
          local cx, cy = 0, 0
          if tool.center then cx, cy = tool.center.x, tool.center.y
          elseif tool.frame then cx, cy = tool.frame.x + tool.frame.w / 2, tool.frame.y + tool.frame.h / 2
          elseif tool.coordinates and tool.coordinates[2] then cx, cy = tool.coordinates[2].x, tool.coordinates[2].y end
          c[INDICATOR_TOOL_IDX] = makeToolElem(cx, cy, draw.tool, currentColor())
          c[INDICATOR_EPH_IDX] = makeEphBadge(cx, cy, draw.ephemeralMode)
        end
      end)
    end
  end

  local function createScreenCanvas(screen)
    local frame = screen:fullFrame()
    local sid = screen:id()
    drawLog.i("Creating canvas for screen", sid, hs.inspect(frame))
    local ok, c = pcall(function()
      return hs.canvas.new(frame)
        :level(hs.canvas.windowLevels.overlay)
        :behavior({ "canJoinAllSpaces", "transient" })
        :clickActivating(false)
    end)
    if not ok or not c then
      drawLog.e("Failed to create canvas for screen", sid, ":", c)
      return nil
    end
    c[1] = { type = "rectangle", action = "fill", fillColor = { alpha = 0 } }
    c:insertElement(makeToolElem(-100, -100, draw.tool, currentColor()))
    c:insertElement(makeEphBadge(-100, -100, false))
    c:show()
    return {
      canvas = c,
      origin = { x = frame.x, y = frame.y },
      strokes = {},
      previewIds = {},
      timers = {},
    }
  end

  local function createAllCanvases()
    for _, screen in ipairs(hs.screen.allScreens()) do
      local sid = screen:id()
      if not draw.screens[sid] then
        local state = createScreenCanvas(screen)
        if state then draw.screens[sid] = state end
      end
    end
  end

  local function cancelTimers(state)
    for _, t in pairs(state.timers) do
      t:stop()
    end
    state.timers = {}
  end

  local function deleteAllCanvases()
    for _, state in pairs(draw.screens) do
      cancelTimers(state)
      if state.canvas then state.canvas:delete() end
    end
    draw.screens = {}
    draw.activeScr = nil
  end

  local function screenForPoint(pt)
    for _, screen in ipairs(hs.screen.allScreens()) do
      local f = screen:fullFrame()
      if pt.x >= f.x and pt.x < f.x + f.w and pt.y >= f.y and pt.y < f.y + f.h then
        return screen:id()
      end
    end
    local primary = hs.screen.primaryScreen()
    return primary and primary:id()
  end

  local function resetPreview()
    local s = activeCanvas()
    if not s then return end
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

  local function fadeAndRemove(scrState, elemIndices, onDone)
    if not scrState or not scrState.canvas then
      if onDone then onDone() end
      return
    end
    local step = 0
    local interval = FADE_DURATION / FADE_STEPS
    local initAlpha = 0.9
    local timer
    timer = hs.timer.doEvery(interval, function()
      step = step + 1
      local alpha = initAlpha * (1 - step / FADE_STEPS)
      if alpha < 0 then alpha = 0 end
      for _, eidx in ipairs(elemIndices) do
        pcall(function()
          local e = scrState.canvas[eidx]
          if e and e.strokeColor then
            local c = {}
            for k, v in pairs(e.strokeColor) do c[k] = v end
            c.alpha = alpha
            e.strokeColor = c
            scrState.canvas[eidx] = e
          end
        end)
      end
      if step >= FADE_STEPS then
        timer:stop()
        table.sort(elemIndices, function(a, b) return a > b end)
        for _, eidx in ipairs(elemIndices) do
          pcall(function() scrState.canvas:removeElement(eidx) end)
        end
        if onDone then onDone() end
      end
    end)
  end

  local function scheduleEphemeral(s, strokeArrIdx)
    local entry = s.strokes[strokeArrIdx]
    if not entry then return end
    s.timers[strokeArrIdx] = hs.timer.doAfter(EPHEMERAL_DELAY, function()
      s.timers[strokeArrIdx] = nil
      fadeAndRemove(s, entry, function()
        for i, v in ipairs(s.strokes) do
          if v == entry then
            table.remove(s.strokes, i)
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
    local s = activeCanvas()
    if not s then return end
    local strokeArrIdx = #s.strokes
    if s.timers[strokeArrIdx] then
      s.timers[strokeArrIdx]:stop()
      s.timers[strokeArrIdx] = nil
    end
    local entry = table.remove(s.strokes)
    if not entry then return end
    for i = #entry, 1, -1 do
      s.canvas:removeElement(entry[i])
    end
  end

  local function clearAll()
    for _, state in pairs(draw.screens) do
      cancelTimers(state)
      local frame = state.canvas:frame()
      state.canvas:delete()
      local ok, c = pcall(function()
        return hs.canvas.new({
          x = state.origin.x, y = state.origin.y,
          w = frame.w, h = frame.h,
        })
          :level(hs.canvas.windowLevels.overlay)
          :behavior({ "canJoinAllSpaces", "transient" })
          :clickActivating(false)
      end)
      if ok and c then
        c[1] = { type = "rectangle", action = "fill", fillColor = { alpha = 0 } }
        c:insertElement(makeToolElem(-100, -100, draw.tool, currentColor()))
        c:insertElement(makeEphBadge(-100, -100, false))
        c:show()
        state.canvas = c
        state.strokes = {}
        state.previewIds = {}
      end
    end
  end

  local activeStroke = nil
  local updateMenu

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
      },
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

      -- Let clicks in the menu bar region pass through
      local pointScreen = hs.mouse.getCurrentScreen()
      if pointScreen then
        local full = pointScreen:fullFrame()
        local usable = pointScreen:frame()
        if rawPt.y < full.y + (usable.y - full.y) then
          return false
        end
      end

      if evType == hs.eventtap.event.types.mouseMoved or evType == hs.eventtap.event.types.leftMouseDragged then
        local sid = screenForPoint(rawPt)
        local s = sid and draw.screens[sid]
        if s then
          local loc = toCanvas(rawPt, s)
          moveIndicator(s, loc.x + INDICATOR_OFFSET_X, loc.y + INDICATOR_OFFSET_Y)
        end
        if evType == hs.eventtap.event.types.mouseMoved then
          return false
        end
      end

      if evType == hs.eventtap.event.types.leftMouseDown then
        local sid = screenForPoint(rawPt)
        draw.activeScr = sid
        local s = activeCanvas()
        if not s then return false end
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

  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "d", toggleOverlay)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "p", function()
    setTool("pen")
    updateMenu()
  end)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "r", function()
    setTool("rect")
    updateMenu()
  end)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "a", function()
    setTool("arrow")
    updateMenu()
  end)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "c", function()
    if draw.active then clearAll(); updateMenu() end
  end)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "z", function()
    if draw.active then undoLast(); updateMenu() end
  end)
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "x", function()
    if draw.active then nextColor(); refreshIndicatorOnAll(); hs.alert.show("Color changed"); updateMenu() end
  end)

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

  draw.menu = hs.menubar.new()
  updateMenu()
end

return M
