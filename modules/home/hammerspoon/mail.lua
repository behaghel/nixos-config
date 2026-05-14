local M = {}

function M.setup(settings)
  settings = settings or {}

  -- Mail sync menubar (Darwin): lightweight status + actions
  local statusFile = settings.statusFile or (os.getenv("HOME") .. "/.cache/mail-sync/status.json")
  local logFile = settings.logFile or (os.getenv("HOME") .. "/Library/Logs/mail-sync.log")
  local icon_ok = "📭"      -- healthy, no fetch pending
  local icon_fetch = "⏳"   -- fetching
  local icon_fail = "⚠️"    -- failed/unhealthy
  local icon_unread = "📬"  -- healthy + unread (if used)
  local m = hs.menubar.new()
  local last = { state = "unknown", last_success = 0, last_attempt = 0 }

  local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local c = f:read("*a")
    f:close()
    return c
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
    hs.task.new("/bin/zsh", nil, { "-lc", "MAIL_SYNC_WAIT=1 mail-sync" }):start()
  end

  local function restart_service()
    local uid = hs.execute("/usr/bin/id -u"):gsub("\n$", "")
    hs.task.new("/bin/launchctl", nil, { "kickstart", "-k", "gui/" .. uid .. "/org.nixos.mail-sync" }):start()
  end

  local function show_logs()
    hs.task.new("/usr/bin/open", nil, { logFile }):start()
  end

  local function refresh()
    local st = read_status()
    if st then last = st end
    set_icon(last)
    local state = last.state or "unknown"
    local ls = last.last_success or 0
    local la = last.last_attempt or 0
    local menu = {
      { title = "Mail sync: " .. state, disabled = true },
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

return M
