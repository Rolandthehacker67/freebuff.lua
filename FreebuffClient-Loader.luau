--!nocheck
-- FREEBUFF CLIENT — v3 bootstrap loader (1 KB)
-- Paste:  loadstring(game:HttpGet("https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/FreebuffClient-Loader.luau"))()
-- This file only points to the byte-verified protected build; the b64+xor
-- payload lives on the build host (always current) — no code ships here.

local BUILD_HOST = "https://site-e068e78f0bf349a38e471e7ec5d6646a.freebuff.page/FreebuffClient-Protected.luau"
local FALLBACK = "https://site-e068e78f0bf349a38e471e7ec5d6646a.freebuff.page/FreebuffClient-Loader-Host.luau"

local function fetch(url)
	local ok, body = pcall(function() return game:HttpGet(url) end)
	if ok and type(body) == "string" and #body > 0 then
		return body
	end
	return nil
end

local src = fetch(BUILD_HOST)
if not src then
	src = fetch(FALLBACK)
end
if not src then
	error("[Freebuff] could not fetch the protected build", 0)
end

local f, err = loadstring(src)
if not f then
	error("[Freebuff] protected build failed to load: " .. tostring(err), 0)
end
return f()
