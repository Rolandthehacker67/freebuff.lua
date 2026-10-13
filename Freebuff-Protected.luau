--!nocheck
-- ╔══════════════════════════════════════════════════════════════╗
-- ║  FREEBUFF DESKTOP — protected build v2 (LZW, chunked payload) ║
-- ║  Paste:  loadstring(game:HttpGet("<RAW_URL>"))()              ║
-- ╚══════════════════════════════════════════════════════════════╝

local REPO = "https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/"
local NPARTS = 17

-- ── fetch the opaque payload parts ──
local chunks = {}
for i = 1, NPARTS do
	local ok, body = pcall(function() return game:HttpGet(REPO .. "parts/p" .. i .. ".lua") end)
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
	-- base64 -> raw (padding-aware: '==' groups emit fewer bytes)
	local rawParts = {}
	local j = 0
	for i = 1, #p, 4 do
		local ch1, ch2, ch3, ch4 = string.byte(p, i, i + 3)
		local a = LOOKUP[ch1] or 0
		local b = LOOKUP[ch2] or 0
		local c = LOOKUP[ch3] or 0
		local d = LOOKUP[ch4] or 0
		local v = a * 262144 + b * 4096 + c * 64 + d
		local hasC = ch3 ~= 61  -- '=' is byte 61
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
	-- xor keystream (bit32 works on all Roblox-era executors)
	local mn = #KEY
	local out = {}
	for i = 1, #raw do
		out[i] = string.char(bit32.bxor(string.byte(raw, i), string.byte(KEY, (i - 1) % mn + 1)))
	end
	return table.concat(out)
end

-- ── LZW(12-bit) inflate ──
local function lzwDecode(bytes)
	local pos = 1
	local acc, accb = 0, 0
	local function nextCode()
		while accb < 12 do
			local b = string.byte(bytes, pos) or 0
			pos += 1
			acc = acc * 256 + b
			accb += 8
			if accb > 20 then acc = acc % 2 ^ 20; accb = math.min(accb, 20) end
		end
		local code = math.floor(acc / 2 ^ (accb - 12)) % 4096
		accb -= 12
		acc = acc % 2 ^ accb
		return code
	end
	local dict = {}
	for i = 0, 255 do dict[i] = string.char(i) end
	local nxt = 258
	local out = {}
	local j = 0
	local prev = nil
	while true do
		local code = nextCode()
		if code == 257 then break end
		if code == 256 then
			-- wipe the ENTIRE table: stale keys at 258..4095 from a previous
			-- cycle would otherwise satisfy dict[code] for codes that are
			-- legitimately not-yet-defined in the new cycle (KwKwK corruption)
			for k in pairs(dict) do dict[k] = nil end
			for i = 0, 255 do dict[i] = string.char(i) end
			nxt = 258
			prev = nil
		else
			local entry
			if dict[code] then
				entry = dict[code]
			elseif code == nxt and prev then
				entry = prev .. string.sub(prev, 1, 1)
			else
				error("[Freebuff] payload corrupt (LZW code " .. code .. ")", 0)
			end
			j += 1 out[j] = entry
			if prev and nxt < 4096 then
				dict[nxt] = prev .. string.sub(entry, 1, 1)
				nxt += 1
			end
			prev = entry
		end
	end
	return table.concat(out)
end

local ok, comp = pcall(decodePayload, P)
if not ok then
	error("[Freebuff] payload decode failed: " .. tostring(comp), 0)
end
local ok2, boot = pcall(lzwDecode, comp)
if not ok2 then
	error("[Freebuff] payload inflate failed: " .. tostring(boot), 0)
end

local f, err = loadstring(boot)
if not f then
	error("[Freebuff] protected payload failed to load: " .. tostring(err), 0)
end
return f()
