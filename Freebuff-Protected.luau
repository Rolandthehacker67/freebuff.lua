--!nocheck
-- ╔══════════════════════════════════════════════════════════════╗
-- ║  FREEBUFF DESKTOP — live-fixed build (2 KB whisper loader)    ║
-- ║  Paste:  loadstring(game:HttpGet(RAW_URL_OF_THIS_FILE))()      ║
-- ║  This file only redirects to the byte-verified fixed build;    ║
-- ║  the heavy payload lives on the build host (always current).   ║
-- ╚══════════════════════════════════════════════════════════════╝

local BUILD_HOST = "https://site-dbbe38d477a74a07a83c8e6c37736ead.freebuff.page/Freebuff-Protected.luau"
local FALLBACK_RAW = "https://site-dbbe38d477a74a07a83c8e6c37736ead.freebuff.page/Freebuff-AllInOne.luau"

local function fetch(url)
	local ok, body = pcall(function() return game:HttpGet(url) end)
	if ok and type(body) == "string" and #body > 0 then return body end
	return nil
end

local src = fetch(BUILD_HOST) or fetch(FALLBACK_RAW)
if not src then
	error("[Freebuff] could not fetch the fixed build from the build host", 0)
end

local f, err = loadstring(src)
if not f then
	error("[Freebuff] fixed build failed to load: " .. tostring(err), 0)
end
return f()
