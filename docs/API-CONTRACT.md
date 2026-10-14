# Freebuff Client — shared API contract (Part 1 Luau + Part 2 website + Part 3 backend)

Backend = Cloudflare Worker (Express-free). All routes under `/api/`. Storage = D1 (SQLite) binding `DB`.
All bodies JSON unless noted. Every response includes `{ ok: true, ... }` or `{ ok: false, error: "<code>", message: "<plain text>" }`.

## Constants
- Link codes: 8 chars uppercase A–Z/0–9, expire after **5 minutes**, single use.
- Session tokens: random 32-byte base64url, stored **SHA-256 hashed**, expire after **30 days**, revocable.
- Rate limits: 10 req/min per IP on link start/poll/confirm; 60 req/min per token on proxied routes; friendly JSON errors on 429.
- CORS: only the website origin (`config.websiteOrigin`) gets `Access-Control-Allow-Origin`. Same-origin requests need no preflight.
- Security headers on every response: X-Content-Type-Options, Referrer-Policy, CSP for the website, no server tokens in logs.

## Link flow (device-link, used by the Roblox script)
1. `POST /api/link/start` → `{ ok, code, expiresAt, pollAfterMs }` — creates the code.
2. `GET  /api/link/poll?code=XXXX&token=...` → while pending: `{ ok, status:"pending", expiresInSec }`
   when linked: `{ ok:"linked"→ status:"linked", sessionToken, account:{name,initial,plan} , expiresInSec }`
   (`status` one of `pending | linked | expired | unknown`).
3. `POST /api/link/confirm` (WEBSITE, browser) body `{ code, deviceName }` →
   `{ ok, status:"linked", device:{id,name}, sessionToken? never returned to browser }`
   — confirms the code for the waiting script. The script polls and receives its own sessionToken.
4. Errors: `invalid_code`, `code_expired`, `already_used`, `rate_limited`.

## Session
- `POST /api/auth/validate` `{ token }` → `{ ok, valid:boolean, account:{name, initial, plan} | null }`
- `POST /api/auth/revoke` `{ token }` → `{ ok }` (revokes the session; also removes the linked-device row)

## Account / usage / models / chat (proxies to real Freebuff)
Config file (`config.js`) holds `FREEBUFF` endpoint URLs **to be confirmed by the user** (comments say UNCONFIRMED).
If a configured URL is empty or the upstream errors, the route returns
`{ ok:false, error:"unavailable", message:"Freebuff endpoint not reachable/configured — no data invented." }`
— NEVER fake data.

- `GET  /api/account?token=...` → upstream-mapped `{ ok, account }` (name, plan, unconfirmed passthrough fields verbatim)
- `GET  /api/usage?token=...`   → `{ ok, usage }` — exactly whatever units/reset Freebuff provides; passthrough
- `GET  /api/models?token=...`  → `{ ok, models:[{ id, name, note, cost, status }] }` (`status`: `available|paused|rate_limited|quota_exhausted`)
- `POST /api/chat` body `{ token, model, messages:[{ role, content }], stream?:bool }`
   → if `stream` and upstream supports SSE, proxy the stream; else await and return
   `{ ok, reply }` or mapped error (`not_logged_in, token_expired, quota_used_up resetAt, rate_limited, model_paused, empty_reply, server_error, network_error`).

## Device registry (for the website dashboard)
- Devices are created on `link/confirm`; each device row: `id, name, lastUsedAt`.
- `GET  /api/devices?token=...` → `{ ok, devices:[{id, name, lastUsedAt}] }` (auth sessions double as devices)
- `POST /api/devices/revoke` `{ token, deviceId }` → `{ ok }`

## Website static files
Served from the same Worker via assets: `/` landing, `/login`, `/link`, `/account`, `/help`, plus single-page
hash routing allowed. Website JS calls only routes above (fetch same-origin).

## D1 schema (created lazily by the worker)
```sql
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY, created_at INTEGER, expires_at INTEGER, used INTEGER DEFAULT 0,
  device_name TEXT, device_id TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, device_id TEXT, device_name TEXT, created_at INTEGER,
  expires_at INTEGER, revoked INTEGER DEFAULT 0, last_used_at INTEGER);
```

## Config file (backend/config.js) — user-editable
```js
export const FREEBUFF = {   // ⚠ UNCONFIRMED — you must verify these against freebuff.com docs
  account:  "",   // e.g. "https://freebuff.com/api/account"     (leave "" if unknown)
  usage:    "",   // e.g. "https://freebuff.com/api/usage"
  models:   "",   // e.g. "https://freebuff.com/api/models"
  chat:     "",   // e.g. "https://freebuff.com/api/chat"   (OpenAI-compatible completions)
  apiKey:   "",   // optional server-side key; never exposed to clients
};
export const SESSION_TTL_SEC = 30 * 24 * 3600;
export const LINK_TTL_SEC = 5 * 60;
export const WEBSITE_ORIGIN = "*::SET-YOUR-DEPLOYED-ORIGIN"; // CORS lock
```

## Luau client (Part 1) — uses ONLY:
- `FREEBUFF.baseUrl .. FREEBUFF.linkStartPath` POST → link/start
- `.. linkPollPath .. "?code=" .. code` GET poll (with `linkPollToken` query param if the backend version uses it)
- `.. linkConfirmPath` is WEBSITE-side; the script never calls it
- `.. validatePath` POST `{ token }` on startup
- `.. logoutPath` POST on logout
- `.. accountPath`, `.. usagePath`, `.. modelsPath` GET with `Authorization: Bearer <token>`
- `.. chatPath` POST for AI chat (stream false first; streaming if enabled)
- Never sends Freebuff passwords anywhere. Token stored in `LunaAI/session.json` when writefile exists.
