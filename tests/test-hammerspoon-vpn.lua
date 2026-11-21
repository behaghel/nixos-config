-- Synthetic AX/task tests: no credentials, macOS UI, network or keyboard input.
package.path = "modules/home/hammerspoon/?.lua;" .. package.path
local E, controller
local function el(attrs, action)
  return {
    attributeValue = function(_, key) return attrs[key] end,
    isAttributeSettable = function(_, key)
      return (key == "AXValue" or key == "AXFocused") and attrs.AXEnabled ~= false
    end,
    setAttributeValue = function(_, key, value)
      if key == "AXValue" and E.rejectWrite then return false end
      attrs[key] = value
      return true
    end,
    performAction = function(_, name)
      if action then return action(name) end
      return true
    end,
  }
end
local function tree(children) return el({ AXChildren = children }) end
local function reset()
  E = { tasks = {}, timers = {}, alerts = {}, presses = 0, restores = 0,
    native = "Disconnected", phase = "idle", profile = "Ireland", taskCount = 0 }
  E.previous = { pid = function() return 1 end,
    activate = function() E.restores = E.restores + 1; return true end }
  E.front = E.previous
  E.gui = { pid = function() return 2 end,
    activate = function() E.front = E.gui; return true end }
  E.tray = { pid = function() return 3 end,
    activate = function() E.front = E.tray; return true end }
  E.popup = el({ AXDOMIdentifier = "vpn-connection", AXValue = "Ireland", AXEnabled = true })
  E.password = el({ AXDOMIdentifier = "vpn-password", AXRole = "AXTextField",
    AXSubrole = "AXSecureTextField", AXEnabled = true })
  E.connect = el({ AXDOMIdentifier = "vpn-connect-button", AXRole = "AXButton",
    AXEnabled = true }, function()
    E.presses = E.presses + 1; E.phase = "otp"; E.active = "Ireland"
    if E.uncertainPress then return nil end
    return true
  end)
  E.code = el({ AXRole = "AXTextField", AXSubrole = "AXSecureTextField", AXEnabled = true })
  local originalCodeRead = E.code.attributeValue
  E.code.attributeValue = function(self, key)
    assert(key ~= "AXValue", "MFA contents must never be read")
    return originalCodeRead(self, key)
  end
  E.otp = tree({ el({ AXRole = "AXStaticText", AXValue = "Please enter OTP" }), E.code })
  E.otp.performAction = function() return true end
  local guiRoot = el({ AXManualAccessibility = false })
  local originalRead = guiRoot.attributeValue
  guiRoot.attributeValue = function(self, key)
    if key == "AXWindows" then
      local fields = { E.popup, E.password, E.connect }
      if E.duplicate then fields[#fields + 1] = E.password end
      if E.phase ~= "idle" then fields = {} end
      return { tree(fields) }
    end
    return originalRead(self, key)
  end
  E.guiRoot = guiRoot
  local trayRoot = { attributeValue = function(_, key)
    if key == "AXExtrasMenuBar" or key == "AXMenuBar" then
      return tree({ el({ AXRole = "AXMenuItem", AXTitle = E.active and
        "Disconnect " .. E.active or "Connect to Ireland" }) })
    elseif key == "AXWindows" then
      return E.phase == "otp" and { E.otp } or {}
    end
  end }
  hs = {
    application = {
      applicationsForBundleID = function(id)
        if id == "com.fortinet.FortiClient" then return E.guiMissing and {} or {E.gui} end
        if id == "com.fortinet.forticlient.macos.vpn" then
          if E.trayMissing then return {} end
          return E.extraTray and { E.extraTray, E.tray } or { E.tray }
        end
        return {}
      end,
      get = function(id)
        if id == "com.fortinet.FortiClient" and not E.guiMissing then return E.gui end
        if id == "com.fortinet.forticlient.macos.vpn" and not E.trayMissing then return E.tray end
      end,
      frontmostApplication = function() return E.front end,
      launchOrFocusByBundleID = function()
        E.guiMissing = false; E.trayMissing = false
        E.launches = (E.launches or 0) + 1; return true
      end,
    },
    axuielement = { applicationElement = function(app)
      if app == E.extraTray then return E.extraRoot end
      return app == E.gui and guiRoot or trayRoot
    end },
    accessibilityState = function() return true end,
    hotkey = { bind = function(mods, key, fn)
      assert(table.concat(mods, "+") == "ctrl+alt+cmd" and key == "v")
      E.hotkey = fn; return { delete = function() E.hotkey = nil end }
    end },
    alert = { show = function(message)
      assert(not message:find("SYNTHETIC_SECRET", 1, true))
      E.alerts[#E.alerts + 1] = message
    end },
    timer = {
      doAfter = function(_, fn)
        local t = { callback = fn, once = true, stop = function(self) self.stopped = true end }
        E.timers[#E.timers + 1] = t; return t
      end,
      doEvery = function(_, fn)
        local t = { callback = fn, stop = function(self) self.stopped = true end }
        E.timers[#E.timers + 1] = t; return t
      end,
    },
    task = { new = function(path, callback, args)
      for _,arg in ipairs(args) do assert(not arg:find("SYNTHETIC_SECRET", 1, true)) end
      local t = { path = path, callback = callback, args = args }
      t.start = function(self)
        E.taskCount = E.taskCount + 1; self.running = true
        E.tasks[#E.tasks + 1] = self; return self
      end
      t.isRunning = function(self) return self.running end
      t.interrupt = function(self) self.running = false end
      return t
    end },
  }
  package.loaded.vpn = nil
  controller = require("vpn").setup({ profile = "Ireland", passEntry = "test/vpn",
    passCommand = "/fake/pass", timeoutTicks = 6 })
end
local function complete(kind, code)
  for i,t in ipairs(E.tasks) do
    if (kind == "pass" and t.path == "/fake/pass") or
       (kind == "status" and t.path == "/usr/sbin/scutil") then
      table.remove(E.tasks, i); t.running = false
      t.callback(code or 0, kind == "pass" and (E.secretOutput or "SYNTHETIC_SECRET\nmetadata\n") or E.native .. "\n",
        code and "synthetic original failure" or "")
      return true
    end
  end
end
local function tick()
  while complete("status") do end
  local current = { table.unpack(E.timers) }
  for _,t in ipairs(current) do
    if not t.stopped then
      if t.once then t.stopped = true end
      t.callback()
    end
  end
  while complete("status") do end
end
local function begin()
  E.hotkey(); complete("status"); tick()
end
local function login()
  begin(); assert(complete("pass"), "password requested"); tick()
end
local count = 0
local function test(name, fn)
  reset(); fn(); count = count + 1; print("ok " .. name)
end

test("hotkey retrieves only the configured entry, focuses native OTP, verifies and restores", function()
  begin()
  local task = E.tasks[#E.tasks]
  assert(task.path == "/fake/pass" and task.args[1] == "show" and task.args[2] == "test/vpn")
  complete("pass"); tick()
  assert(E.password:attributeValue("AXValue") == "SYNTHETIC_SECRET")
  assert(E.presses == 1 and E.code:attributeValue("AXFocused") == true)
  assert(E.restores == 0)
  E.phase = "connected"; E.native = "Connected"; tick()
  assert(E.restores == 1 and E.alerts[#E.alerts]:find("connected"))
  assert(E.guiRoot:attributeValue("AXManualAccessibility") == false)
end)
test("already connected never retrieves credentials", function()
  E.active = "Ireland"; E.native = "Connected"; begin()
  assert(not complete("pass") and E.presses == 0)
end)
test("another active profile is preserved", function()
  E.active = "Other"; E.native = "Connected"; begin()
  assert(not complete("pass") and E.presses == 0)
end)
test("an existing OTP attempt is focused, not duplicated", function()
  E.active = "Ireland"; E.phase = "otp"; begin()
  assert(not complete("pass") and E.presses == 0 and E.code:attributeValue("AXFocused"))
end)
test("repeat presses during password retrieval do not duplicate or steal PIN focus", function()
  begin(); local tasks = E.taskCount; E.front = E.previous; E.hotkey()
  assert(E.taskCount == tasks and E.front == E.previous)
end)
test("GPG cancellation stops before Connect and preserves non-secret cause", function()
  begin(); complete("pass", 2)
  assert(E.presses == 0 and controller.lastFailure.stderr == "synthetic original failure")
  assert(controller.lastFailure.stdout == nil, "never retain sensitive failed stdout")
end)
test("profile changes during secret retrieval prevent injection", function()
  begin(); E.popup:setAttributeValue("AXValue", "Other"); complete("pass")
  assert(E.presses == 0 and E.password:attributeValue("AXValue") == nil)
end)
test("ambiguous password controls fail closed", function()
  E.duplicate = true; begin(); assert(not complete("pass") and E.presses == 0)
end)
test("non-secure password control fails closed", function()
  E.password:setAttributeValue("AXSubrole", "AXTextField")
  begin(); assert(not complete("pass") and E.presses == 0)
end)
test("rejected password write never submits", function()
  begin(); E.rejectWrite = true; complete("pass"); assert(E.presses == 0)
end)
test("uncertain Connect result never retries", function()
  E.uncertainPress = true; login(); tick(); assert(E.presses == 1 and E.restores == 0)
end)
test("native Connected with OTP still pending is not success", function()
  login(); E.native = "Connected"; tick(); assert(E.restores == 0)
end)
test("a changed active profile is never announced as Ireland success", function()
  login(); E.phase = "connected"; E.active = "Other"; E.native = "Connected"; tick()
  assert(E.restores == 0)
end)
test("timeout stops observation without disconnecting or retrying", function()
  login(); for _=1,9 do tick() end
  assert(E.presses == 1 and E.restores == 0)
end)
test("success does not override an intentional app switch", function()
  login(); E.front = { pid = function() return 99 end }
  E.phase = "connected"; E.native = "Connected"; tick(); assert(E.restores == 0)
end)
test("late secret output after stop is ignored", function()
  begin(); controller.stop(); complete("pass"); assert(E.presses == 0)
end)
test("a missing client is launched once before inspecting its state", function()
  E.guiMissing = true; E.trayMissing = true; begin()
  assert(E.launches == 1 and complete("pass") and E.presses == 0)
end)
test("a disconnected different selection is changed to the exact target", function()
  E.popup:setAttributeValue("AXValue", "Other"); begin(); complete("pass"); tick()
  assert(E.popup:attributeValue("AXValue") == "Ireland" and E.presses == 1)
end)
test("failed profile selection stops before requesting credentials", function()
  E.popup:setAttributeValue("AXValue", "Other"); E.rejectWrite = true; begin()
  assert(not complete("pass") and E.presses == 0)
end)
test("ambiguous native OTP fields stop rather than guessing", function()
  E.otp = tree({ el({ AXRole="AXStaticText", AXValue="Please enter OTP" }),
    E.code, el({ AXRole="AXTextField", AXSubrole="AXSecureTextField", AXEnabled=true }) })
  login(); assert(E.code:attributeValue("AXFocused") ~= true and E.restores == 0)
end)
test("an unrelated native secure dialog is not treated as MFA", function()
  E.otp = tree({ el({ AXRole="AXStaticText", AXValue="Please enter password" }), E.code })
  login(); assert(E.code:attributeValue("AXFocused") ~= true)
end)
test("unrecognized native status never starts authentication", function()
  E.native = "Unknown"; begin(); assert(not complete("pass") and E.presses == 0)
end)
test("native error dialogs stop immediately without pressing OK", function()
  E.otp = tree({ el({ AXRole="AXStaticText", AXValue="Authentication failed" }),
    el({ AXRole="AXButton", AXTitle="OK" }, function() error("must not dismiss errors") end) })
  login(); assert(controller.state == "idle" and E.presses == 1)
end)
test("MFA cancellation never restarts login", function()
  login(); E.phase="idle"; E.active=nil; E.native="Disconnected"; tick()
  assert(controller.state == "idle" and E.presses == 1 and E.restores == 0)
end)
test("lost active-profile evidence stops observation", function()
  login(); E.trayMissing=true; tick(); assert(controller.state == "idle" and E.restores == 0)
end)
test("empty credential output never submits", function()
  E.secretOutput=""; begin(); complete("pass"); tick(); assert(E.presses == 0)
end)
test("an accepted but ineffective OTP focus is not trusted", function()
  E.code.setAttributeValue=function() return true end
  login(); assert(controller.state == "idle" and E.restores == 0)
end)
local function staleTray(title)
  E.extraTray={pid=function() return 4 end}
  E.extraRoot={attributeValue=function(_,key)
    if key=="AXExtrasMenuBar" then
      return tree({el({AXRole="AXMenuItem", AXTitle=title})})
    elseif key=="AXWindows" then return {} end
  end}
end
test("a stale first tray does not hide the named active connection", function()
  staleTray("Connect to Ireland"); E.active="Ireland"; E.native="Connected"; begin()
  assert(not complete("pass") and E.presses==0)
  assert(E.alerts[#E.alerts]:find("already connected"))
end)
test("OTP and focus return use the actual tray owner among duplicate instances", function()
  staleTray("Connect to Ireland"); login()
  assert(E.code:attributeValue("AXFocused"))
  E.phase="connected"; E.native="Connected"; tick(); assert(E.restores==1)
end)
test("conflicting active tray instances fail closed", function()
  staleTray("Disconnect Other"); E.active="Ireland"; E.native="Connected"; begin()
  assert(not complete("pass") and E.presses==0 and E.restores==0)
end)
test("app hotkeys preserve other bindings but no longer claim V", function()
  local keys={}
  hs.hotkey.bind=function(mods,key) keys[table.concat(mods,"+")..":"..key]=true end
  package.loaded.hotkeys=nil; require("hotkeys").setup()
  assert(not keys["ctrl+alt+cmd:v"])
  for _,key in ipairs({"t","e","f","s"}) do assert(keys["ctrl+alt+cmd:"..key]) end
end)
print("VPN hotkey: " .. count .. " tests passed")
