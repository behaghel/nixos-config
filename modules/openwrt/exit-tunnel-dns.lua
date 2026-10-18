-- Managed by nixos-config OpenWrt exit-node module.
-- Pure JSON transformation/check; the caller owns the native RPC invocation.
local json = require("cjson")
local document = json.decode(io.read("*a"))
if arg[1] == "peer-check" then
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
