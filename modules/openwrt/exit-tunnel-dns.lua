-- Managed by nixos-config OpenWrt exit-node module.
-- Pure transformations/checks; the caller owns native writes and RPCs.
local text = io.read("*a")
if arg[1] == "scope" or arg[1] == "scope-check" then
    local suffix = assert(arg[2], "Tailnet suffix required")
    assert(suffix:match("^[a-z0-9%-]+%.ts%.net$"), "invalid Tailnet suffix")
    local desired = "/" .. suffix .. "/100.100.100.100"
    local output, count, correct, offset = {}, 0, true, 1
    while offset <= #text do
        local newline = text:find("\n", offset, true)
        local line = text:sub(offset, (newline or (#text + 1)) - 1)
        local ending = newline and "\n" or ""
        offset = (newline or #text) + 1
        local server = line:match("^%s*server%s*=%s*(.-)%s*$")
        if server and server:find("100.100.100.100", 1, true) then
            assert(server == "/ts.net/100.100.100.100" or server == desired,
                   "unmanaged Quad100 forwarder; inspect before changing")
            count = count + 1
            correct = correct and server == desired
            if count == 1 then
                output[#output + 1] = "server=" .. desired .. ending
            end
        else
            output[#output + 1] = line .. ending
        end
    end
    if arg[1] == "scope-check" then
        os.exit(count == 1 and correct and 0 or 1)
    end
    assert(count > 0, "native MagicDNS forwarder missing")
    io.write(table.concat(output))
    os.exit(0)
end
local json = require("cjson")
local document = json.decode(text)
if arg[1] == "peer-check" then
    if document.MagicDNSSuffix ~= arg[4]
        or not document.CurrentTailnet
        or document.CurrentTailnet.MagicDNSEnabled ~= true then os.exit(1) end
    for _, peer in pairs(document.Peer or {}) do
        for _, address in ipairs(peer.TailscaleIPs or {}) do
            if address == arg[2] and peer.ID == arg[3]
                and peer.ExitNodeOption == true then os.exit(0) end
        end
    end
    os.exit(1)
end
local current = assert(document.result, "native DNS result unavailable")
assert(type(current) == "table" and type(current.mode) == "string",
       "unexpected native DNS schema")
local address = assert(arg[2], "resolver address required")
local ready = current.mode == "manual"
    and current.manual_type == "manual"
    and current.manual_enable == true
    and current.manual_local_dns == false
    and current.force_dns == true
    and type(current.manual_list) == "table"
    and #current.manual_list == 1 and current.manual_list[1] == address
if arg[1] == "check" then
    os.exit(ready and 0 or 1)
end
assert(arg[1] == "payload" or arg[1] == "restore", "use check, payload, or restore")
if arg[1] == "payload" then
    current.mode = "manual"
    current.manual_type = "manual"
    current.manual_enable = true
    current.manual_local_dns = false
    current.force_dns = true
    current.manual_list = { address }
end
io.write(json.encode({ module = "dns", func = "set_config", params = current }))
