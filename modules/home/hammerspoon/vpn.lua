local M = {}
local GUI = "com.fortinet.FortiClient"
local TRAY = "com.fortinet.forticlient.macos.vpn"

-- Inspect only bounded application-owned trees, not system-wide UI or keystrokes.
local function walk(roots)
  local nodes = {}
  local function push(element)
    assert(#nodes < 800, "Accessibility tree exceeds inspection bound")
    nodes[#nodes + 1] = element
  end
  for _,root in ipairs(roots or {}) do push(root) end
  local i = 1
  while i <= #nodes do
    assert(#nodes <= 800, "Accessibility tree exceeds inspection bound")
    for _,child in ipairs(nodes[i]:attributeValue("AXChildren") or {}) do
      push(child)
    end
    i = i + 1
  end
  return nodes
end

local function appsFor(id)
  return hs.application.applicationsForBundleID(id) or {}
end

local function rootFor(id)
  local apps = appsFor(id)
  assert(#apps <= 1, "Ambiguous application instances")
  local app = apps[1]
  return app, app and hs.axuielement.applicationElement(app)
end

local function trayState(profile)
  local bars = {}
  for _,app in ipairs(appsFor(TRAY)) do
    local root = hs.axuielement.applicationElement(app)
    local bar = root:attributeValue("AXExtrasMenuBar") or root:attributeValue("AXMenuBar")
    if bar then bars[#bars + 1] = bar end
  end
  local active, available
  for _,e in ipairs(walk(bars)) do
    if e:attributeValue("AXRole") == "AXMenuItem" then
      local title = e:attributeValue("AXTitle") or ""
      local name = title:match("^Disconnect (.+)$")
      if name then
        assert(not active, "Ambiguous active VPN profile")
        active = name
      elseif title == "Connect to " .. profile then
        available = true
      end
    end
  end
  if active then return "active", active end
  return available and "disconnected" or "unknown"
end

local function otpDialog()
  local found
  for _,app in ipairs(appsFor(TRAY)) do
    local root = hs.axuielement.applicationElement(app)
    for _,window in ipairs(root:attributeValue("AXWindows") or {}) do
    local otp, fields = false, {}
    local labelled, hasOK = false, false
    for _,e in ipairs(walk({ window })) do
      local role = e:attributeValue("AXRole")
      -- Only static labels are read. In particular, never read the Code value.
      if role == "AXStaticText" then
        local label = e:attributeValue("AXValue")
        if type(label) == "string" and label ~= "" then labelled = true end
        if label == "Please enter OTP" then otp = true end
      elseif role == "AXButton" and e:attributeValue("AXTitle") == "OK" then
        hasOK = true
      elseif role == "AXTextField" and e:attributeValue("AXSubrole") == "AXSecureTextField"
        and e:attributeValue("AXEnabled") == true then
        fields[#fields + 1] = e
      end
    end
    if otp then
      assert(not found and #fields == 1, "Ambiguous OTP dialog")
      found = { app = app, window = window, field = fields[1] }
    elseif labelled and hasOK then
      error("Unexpected FortiTray dialog; native details left visible")
    end
  end
  end
  return found
end

local function focusOTP(dialog)
  assert(dialog.field:isAttributeSettable("AXFocused"), "OTP field cannot receive focus")
  dialog.app:activate(true)
  assert(dialog.window:performAction("AXRaise"), "OTP window could not be raised")
  assert(dialog.field:setAttributeValue("AXFocused", true), "OTP focus rejected")
  assert(dialog.field:attributeValue("AXFocused") == true, "OTP focus not confirmed")
  local front = hs.application.frontmostApplication()
  assert(front and front:pid() == dialog.app:pid(), "OTP application is not frontmost")
end

local function loginForm()
  local app,root = rootFor(GUI)
  if not root then return end
  local f = {}
  for _,e in ipairs(walk(root:attributeValue("AXWindows"))) do
    local id = e:attributeValue("AXDOMIdentifier")
    if id == "vpn-connection" or id == "vpn-password" or id == "vpn-connect-button" then
      assert(not f[id], "Ambiguous login controls")
      f[id] = e
    end
  end
  return app, root, f
end

function M.setup(cfg)
  assert(cfg and cfg.profile and cfg.passCommand and cfg.passEntry, "VPN configuration missing")
  local controller, operation = { state = "idle" }, nil
  local function phase(op, value) op.phase = value; controller.state = value end
  local function finish(message, success)
    local op = operation
    operation = nil -- Invalidate callbacks before interrupting owned processes.
    controller.state = "idle"
    if op then
      if op.timer then op.timer:stop() end
      for _,task in ipairs({ op.nativeTask or false, op.passTask or false }) do
        if task and task:isRunning() then task:interrupt() end
      end
      if op.axRoot and op.oldAX == false then
        pcall(function() op.axRoot:setAttributeValue("AXManualAccessibility", false) end)
      end
      if success and op.previous then
        local ok, restored = pcall(function()
          local front = hs.application.frontmostApplication()
          if front then
            for _,id in ipairs({ GUI, TRAY }) do
              for _,app in ipairs(appsFor(id)) do
                if front:pid() == app:pid() then return op.previous:activate() end
              end
            end
          end
          return true -- Do not steal focus after a deliberate app switch.
        end)
        if not ok or not restored then message = message .. "; could not restore previous app" end
      end
    end
    if message then hs.alert.show(message, 2) end
  end
  local function guarded(fn)
    return function(...)
      local ok,err = pcall(fn, ...)
      if not ok then
        controller.lastFailure = { stage = controller.state, cause = err }
        finish("VPN automation stopped; check FortiClient")
      end
    end
  end
  local function nativeStatus(op, callback)
    if op.statusBusy or operation ~= op then return end
    op.statusBusy = true
    local task = hs.task.new("/usr/sbin/scutil", guarded(function(code, out, err)
      op.nativeTask, op.statusBusy = nil, false
      if operation ~= op then return end
      local status = out:match("^([^\r\n]+)")
      if code ~= 0 or not ({ Connected=true, Disconnected=true, Connecting=true,
        Disconnecting=true, Reasserting=true })[status] then
        controller.lastFailure = { stage="status", exitCode=code, stderr=err, stdout=out }
        finish("Could not verify VPN state; check FortiClient")
        return
      end
      callback(status)
    end), { "--nc", "status", cfg.service or "VPN" })
    op.nativeTask = task
    if not task or not task:start() then finish("Could not inspect VPN state") end
  end
  local function watch(op)
    local ticks = 0
    op.timer = hs.timer.doEvery(0.5, guarded(function()
      if operation ~= op then return end
      ticks = ticks + 1
      local state,name = trayState(cfg.profile)
      if state == "unknown" then
        finish("Could not verify the active VPN profile; check FortiClient")
        return
      end
      if state == "active" and name ~= cfg.profile then
        finish("Another VPN profile is active; left unchanged")
        return
      end
      local otp = otpDialog()
      if otp then
        if not op.sawOTP then focusOTP(otp) end
        op.sawOTP = true
        phase(op, "mfa")
      else
        nativeStatus(op, function(status)
          local current,active = trayState(cfg.profile)
          if current == "active" and active ~= cfg.profile then
            finish("Another VPN profile is active; left unchanged")
          elseif status == "Connected" and current == "active" and active == cfg.profile
            and not otpDialog() then
            finish("Ireland VPN connected", true)
          elseif status == "Disconnected" and current == "disconnected" then
            local _,_,f = loginForm()
            if op.sawOTP or (ticks > 4 and f and f["vpn-connect-button"]
              and f["vpn-connect-button"]:attributeValue("AXEnabled") == true) then
              finish("VPN connection did not complete; check FortiClient")
            end
          end
        end)
      end
      if operation == op and ticks >= (cfg.timeoutTicks or 360) then
        finish("Could not confirm VPN connection in time; check FortiClient")
      end
    end))
  end
  local function validateForm()
    local app,root,f = loginForm()
    assert(app and f["vpn-connection"] and f["vpn-password"] and f["vpn-connect-button"],
      "Login controls unavailable")
    assert(f["vpn-connection"]:attributeValue("AXValue") == cfg.profile, "Selected profile changed")
    local password = f["vpn-password"]
    assert(password:attributeValue("AXRole") == "AXTextField" and
      password:attributeValue("AXSubrole") == "AXSecureTextField" and
      password:attributeValue("AXEnabled") == true and password:isAttributeSettable("AXValue"),
      "Secure password field unavailable")
    assert(f["vpn-connect-button"]:attributeValue("AXEnabled") == true, "Connect is unavailable")
    return app,root,f
  end
  local function requestPassword(op)
    validateForm()
    phase(op, "unlock")
    op.passTask = hs.task.new(cfg.passCommand, guarded(function(code, out, err)
      op.passTask = nil
      if operation ~= op then return end
      if code ~= 0 then
        -- Never retain sensitive stdout, even on failure. No secrets in alerts.
        controller.lastFailure = { stage="pass", exitCode=code, stderr=err }
        finish("Password request cancelled or failed; VPN not started")
        return
      end
      local password = out:match("^([^\r\n]+)")
      out = nil
      if not password then finish("Password Store returned no password"); return end
      nativeStatus(op, function(status)
        local state = trayState(cfg.profile)
        if status ~= "Disconnected" or state ~= "disconnected" then
          password = nil
          finish("VPN state changed; no password submitted")
          return
        end
        local app,_,f = validateForm() -- Recheck after the asynchronous PIN request.
        assert(f["vpn-password"]:setAttributeValue("AXValue", password), "Password write rejected")
        password = nil -- Drop references; Lua/native strings cannot guarantee zeroization.
        app:activate(true)
        phase(op, "connecting")
        if not f["vpn-connect-button"]:performAction("AXPress") then
          finish("Connection request outcome uncertain; check FortiClient")
          return -- Never retry an uncertain login action.
        end
        watch(op)
      end)
    end), { "show", cfg.passEntry })
    if not op.passTask or not op.passTask:start() then finish("Could not start Password Store") end
  end
  local function prepare(op, attempts)
    if operation ~= op then return end
    local app,root,f = loginForm()
    if app and root then
      op.axRoot = root
      if op.oldAX == nil then op.oldAX = root:attributeValue("AXManualAccessibility") end
      assert(root:setAttributeValue("AXManualAccessibility", true), "Cannot inspect FortiClient controls")
      if f["vpn-connection"] and f["vpn-password"] and f["vpn-connect-button"] then
        local popup = f["vpn-connection"]
        if popup:attributeValue("AXValue") ~= cfg.profile then
          assert(popup:attributeValue("AXEnabled") == true and popup:isAttributeSettable("AXValue"),
            "Cannot select Ireland profile")
          assert(popup:setAttributeValue("AXValue", cfg.profile), "Profile selection rejected")
        end
        requestPassword(op)
        return
      end
    end
    if attempts >= 24 then finish("Could not find FortiClient login controls"); return end
    op.timer = hs.timer.doAfter(0.25, guarded(function() prepare(op, attempts + 1) end))
  end
  local checkInitial
  checkInitial = function(op, attempts)
    nativeStatus(op, function(status)
      local state,name = trayState(cfg.profile)
      if state == "active" then
        if name ~= cfg.profile then finish("Another VPN profile is active; left unchanged")
        elseif status == "Connected" and not otpDialog() then finish("Ireland VPN already connected")
        else
          local otp = otpDialog()
          if otp then focusOTP(otp)
          else local app=hs.application.get(GUI); if app then app:activate(true) end end
          finish("Ireland connection already in progress; no new login started")
        end
      elseif state == "unknown" and attempts < 24 then
        -- Launch once, then observe. Never treat missing tray evidence as idle.
        if not op.launched then
          op.launched = true
          hs.application.launchOrFocusByBundleID(GUI)
        end
        op.timer = hs.timer.doAfter(0.25, guarded(function() checkInitial(op, attempts + 1) end))
      elseif status ~= "Disconnected" or state ~= "disconnected" then
        finish("VPN state is not safely disconnected; check FortiClient")
      else
        phase(op, "opening")
        local app = hs.application.get(GUI)
        if app then app:activate(true)
        else hs.application.launchOrFocusByBundleID(GUI) end
        prepare(op, 0)
      end
    end)
  end
  controller.trigger = guarded(function()
    if operation then
      if operation.phase == "unlock" then hs.alert.show("Waiting for YubiKey/PIN approval", 2)
      else
        local otp = otpDialog()
        if otp then focusOTP(otp)
        else local app=hs.application.get(GUI); if app then app:activate(true) end end
      end
      return
    end
    controller.lastFailure = nil
    assert(hs.accessibilityState(), "Hammerspoon needs Accessibility permission")
    local op = { previous = hs.application.frontmostApplication() }
    operation = op
    phase(op, "checking")
    checkInitial(op, 0)
  end)
  controller.stop = function() finish() end
  M.controller = controller -- Private, in-memory diagnostics; never secret stdout.
  controller.binding = hs.hotkey.bind({ "ctrl", "alt", "cmd" }, "v", controller.trigger)
  return controller
end

return M
