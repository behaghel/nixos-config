local M = {}

-- Search only accessibility metadata; never read meeting notes or transcripts.
local function findControls(root)
  local queue, cursor = { root }, 1
  local trigger
  while cursor <= #queue and cursor <= 4000 do
    local element = queue[cursor]
    cursor = cursor + 1
    local role = element:attributeValue("AXRole")
    if role == "AXMenuItem"
      and element:attributeValue("AXTitle") == "Record now botless" then
      return element, trigger
    end
    if role == "AXPopUpButton" then
      -- Fellow's unlabeled recording menu has this CSS module class. Ignore
      -- its generated suffix; fail safely if a future app changes the class.
      local classes = element:attributeValue("AXDOMClassList") or {}
      for _, class in ipairs(classes) do
        if class:find("RecordButton-module__recordButton__", 1, true) then
          trigger = element
        end
      end
    end
    for _, child in ipairs(element:attributeValue("AXChildren") or {}) do
      if #queue >= 4000 then break end
      queue[#queue + 1] = child
    end
  end
  return nil, trigger
end

function M.setup()
  local pending = false
  hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "'", function()
    if pending then return end
    local app = hs.application.get("com.electron.fellow")
    if not app then
      hs.alert.show("Open Fellow before starting a botless recording", 2)
      return
    end
    -- Capture before activating Fellow; the asynchronous lookup must not
    -- mistake Fellow for the app the user was working in.
    local previousApp = hs.application.frontmostApplication()
    if previousApp and previousApp:pid() == app:pid() then previousApp = nil end
    pending = true
    local function finish(message)
      pending = false
      hs.alert.show(message, 2)
    end
    local function restoreFocus()
      local ok, restored = pcall(function()
        local current = hs.application.frontmostApplication()
        -- During the delay the user may have deliberately switched elsewhere.
        if not current or current:pid() ~= app:pid() then return true end
        return previousApp:activate()
      end)
      if not ok or not restored then
        finish("Fellow: botless recording requested; could not restore previous app")
      else
        finish("Fellow: botless recording requested")
      end
    end
    app:activate(true)
    local root = hs.axuielement.applicationElement(app)
    if not root then
      finish("Cannot access Fellow. Check Hammerspoon Accessibility permission.")
      return
    end
    -- Electron does not expose its web controls until this is enabled.
    root:setAttributeValue("AXEnhancedUserInterface", true)
    local opened = false
    local function attempt(number)
      local ok = pcall(function()
        local item, trigger = findControls(hs.axuielement.applicationElement(app))
        if item then
          if item:attributeValue("AXEnabled") ~= true then
            finish("Fellow's botless recording action is disabled")
            return
          end
          -- Do not retry AXPress: an error can leave its effects uncertain.
          local pressed = item:performAction("AXPress")
          if pressed then
            if previousApp then
              -- Fellow can activate itself again as recording starts. Give
              -- that late focus change time to settle before returning once.
              -- AXPress acceptance is not proof that audio is flowing.
              hs.timer.doAfter(2, restoreFocus)
            else
              finish("Fellow: botless recording requested")
            end
          else
            finish("Could not confirm the recording request. Check Fellow.")
          end
          return
        end
        if trigger and not opened and trigger:attributeValue("AXEnabled") == true then
          opened = true
          if not trigger:performAction("AXPress") then
            finish("Could not open Fellow's recording menu")
            return
          end
        end
        if number >= 12 then
          finish("Cannot find Record now botless. Check Fellow's recording menu.")
        else
          hs.timer.doAfter(0.25, function() attempt(number + 1) end)
        end
      end)
      if not ok then
        -- Avoid logging UI metadata or retrying an uncertain recording action.
        finish("Fellow automation failed. Check the app before trying again.")
      end
    end
    hs.timer.doAfter(0.25, function() attempt(1) end)
  end)
end

return M
