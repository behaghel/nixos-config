-- Run from the repository root with Lua; no macOS UI or recording is used.
package.path = "modules/home/hammerspoon/?.lua;" .. package.path
local bindings, queue, alerts, presses, app, root
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
  app = { activate = function() end }
  hs = {
    hotkey = { bind = function(mods, key, fn)
      assert(table.concat(mods, "+") == "ctrl+alt+cmd")
      assert(key == "'")
      bindings.record = fn
    end },
    application = { get = function(id)
      assert(id == "com.electron.fellow")
      return app
    end },
    axuielement = { applicationElement = function() return root end },
    timer = { doAfter = function(_, fn) queue[#queue + 1] = fn end },
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

reset({ record(false) })
bindings.record()
drain()
assert(presses == 0, "never press a disabled recording item")
assert(#alerts == 1)

reset({ element({ AXRole = "AXMenuItem", AXTitle = "Record via link…",
  AXEnabled = true }) })
bindings.record()
drain()
assert(presses == 0, "never fall back to another recording mode")
assert(#alerts == 1)

reset({ record(true, function() return nil, "failed" end) })
bindings.record()
drain()
assert(presses == 1, "never retry an uncertain recording action")
assert(#alerts == 1)

reset()
app = nil
bindings.record()
drain()
assert(presses == 0 and #alerts == 1)

print("Fellow hotkey: 6 tests passed")
