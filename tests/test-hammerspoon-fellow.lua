-- Run from the repository root with Lua; no macOS UI or recording is used.
package.path = "modules/home/hammerspoon/?.lua;" .. package.path
local bindings, queue, alerts, presses, app, root
local previous, frontmost, restores, fellowActivations, timerDelays
local function element(attrs, action)
  return {
    attributeValue = function(_, key) return attrs[key] end,
    setAttributeValue = function(_, key, value) attrs[key] = value end,
    performAction = function()
      presses = presses + 1
      if action then return action() end
      return true
    end,
  }
end
local function reset(children)
  bindings, queue, alerts, presses = {}, {}, {}, 0
  root = element({ AXChildren = children or {} })
  restores, fellowActivations, timerDelays = 0, 0, {}
  previous = {
    pid = function() return 22 end,
    activate = function()
      assert(presses > 0, "restore focus only after requesting recording")
      restores = restores + 1
      return true
    end,
  }
  frontmost = previous
  app = {
    pid = function() return 11 end,
    activate = function()
      fellowActivations = fellowActivations + 1
      frontmost = app
      return true
    end,
  }
  hs = {
    hotkey = { bind = function(mods, key, fn)
      assert(table.concat(mods, "+") == "ctrl+alt+cmd")
      assert(key == "'")
      bindings.record = fn
    end },
    application = {
      get = function(id)
        assert(id == "com.electron.fellow")
        return app
      end,
      frontmostApplication = function() return frontmost end,
    },
    axuielement = { applicationElement = function() return root end },
    timer = { doAfter = function(delay, fn)
      timerDelays[#timerDelays + 1] = delay
      queue[#queue + 1] = fn
    end },
    alert = { show = function(text) alerts[#alerts + 1] = text end },
  }
  package.loaded.fellow = nil
  require("fellow").setup()
end
local function drain()
  local count = 0
  while #queue > 0 do
    count = count + 1
    assert(count <= 30, "retry loop must be bounded")
    table.remove(queue, 1)()
  end
end
local function record(enabled, action)
  return element({ AXRole = "AXMenuItem", AXTitle = "Record now botless",
    AXEnabled = enabled }, action)
end

reset({ record(true) })
bindings.record()
bindings.record() -- Ignore another keypress while this request is pending.
drain()
assert(presses == 1)
assert(root:attributeValue("AXEnhancedUserInterface") == true)
assert(restores == 1, "return to the app captured before focusing Fellow")

local target = record(true)
local trigger = element({ AXRole = "AXPopUpButton", AXEnabled = true,
  AXDOMClassList = { "RecordButton-module__recordButton__GRkOj" } }, function()
  root = element({ AXChildren = { target } })
  return true
end)
reset({ trigger })
bindings.record()
drain()
assert(presses == 2, "open recording menu, then press the botless item")
assert(restores == 1)

reset({ record(false) })
bindings.record()
drain()
assert(presses == 0, "never press a disabled recording item")
assert(restores == 0, "leave Fellow visible on failure")
assert(#alerts == 1)

reset({ element({ AXRole = "AXMenuItem", AXTitle = "Record via link…",
  AXEnabled = true }) })
bindings.record()
drain()
assert(presses == 0, "never fall back to another recording mode")
assert(restores == 0)
assert(#alerts == 1)

reset({ record(true, function() return nil, "failed" end) })
bindings.record()
drain()
assert(presses == 1, "never retry an uncertain recording action")
assert(restores == 0)
assert(#alerts == 1)

reset()
app = nil
bindings.record()
drain()
assert(presses == 0 and #alerts == 1)

reset({ record(true) })
frontmost = app
bindings.record()
drain()
assert(restores == 0 and fellowActivations == 1,
  "do not reactivate Fellow when it was already frontmost")

reset({ record(true) })
frontmost = nil
bindings.record()
drain()
assert(presses == 1 and restores == 0, "missing previous app is harmless")

reset({ record(true) })
previous.activate = function() return false end
bindings.record()
drain()
assert(presses == 1, "do not repeat recording if focus restoration fails")
assert(#alerts == 1 and alerts[1]:find("previous app", 1, true))

reset({ record(true) })
previous.activate = function() error("previous app exited") end
bindings.record()
drain()
assert(presses == 1, "do not repeat recording if the previous app exited")
assert(#alerts == 1 and alerts[1]:find("previous app", 1, true))

reset({ record(true) })
bindings.record()
table.remove(queue, 1)() -- Recording request accepted; focus must wait.
assert(presses == 1 and restores == 0, "let Fellow's late focus change settle")
assert(timerDelays[#timerDelays] == 2, "wait two seconds after AXPress")
frontmost = app -- Fellow focuses itself again while starting the recording.
bindings.record() -- Still pending: do not request another recording.
drain()
assert(presses == 1 and restores == 1)

reset({ record(true) })
bindings.record()
table.remove(queue, 1)()
frontmost = { pid = function() return 33 end } -- User switches apps.
drain()
assert(presses == 1 and restores == 0, "do not override the user's new app")

reset({ record(true) })
bindings.record()
table.remove(queue, 1)()
frontmost = nil
drain()
assert(presses == 1 and restores == 0, "do not steal focus without a frontmost app")

print("Fellow hotkey: 13 tests passed")
