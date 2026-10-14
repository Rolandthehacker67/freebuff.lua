# 🐃 Freebuff — Protected Luau Build

One-paste loader for the **protected build** of the Freebuff client (chat, files, models, account, settings — one window).

## ✦ Install (one paste)

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/FreebuffClient-Loader.luau"))()
```

**F2** toggles the window · `/` opens the command palette (where supported).

## ✦ v4 GUI hotfix (2026-10-14)

Complete GUI rewrite — opaque, auto-scaled, simple rail+sidebar layout:

- **Opaque everywhere** — no transparency games; every panel draws solid theme colors.
- **Auto-fit scaling** — the window never exceeds ~92% of your screen; Settings has a Zoom control (40%–160%) if you still want it bigger.
- **Every page is a plain frame** inside ONE page-host — page switching is Visible toggles only, so nothing bleeds across pages anymore.
- **New chat works** — big `＋ New chat` button in the sidebar; every chat switch re-renders the list and the messages.
- **Chat composer fixed** — real input box + orange ↑ send button pinned at the bottom of the Chat page only; Enter submits; without a linked device it honestly tells you to log in first (never fails silently).
- **Login page in-app** — Account → Start linking → an 8-character code appears → open the website → enter the code → back in the app you are linked automatically.
- **Data (Files) folder** — `＋ New file` creates an exactly-empty file (self-tested on boot), Save writes it to `LunaAI/scripts`, no stray "start chat" leftovers.
- **Toasts fixed** — real solid toast chips (bottom-right of the window); everything buffered before the GUI exists is drained right after the layout builds.
- **Window controls top-right** — the `–` and `✕` buttons sit pinned to the top-RIGHT corner, away from the Roblox menu.
- **Smooth open/close** — the window scales in/out with a short tween (falls back to instant when tweens are unavailable).
- **Resize grip** — drag the `◢` corner grip (bottom-right) to resize the window freely; clamped to sane minimums and to your screen.

## ✦ Website (link-code page)

https://site-c6f79b10eafc4ab39f22ee80154776ff.freebuff.page

- The **landing page now has the code box right in the hero** — type the 8-character code there, Confirm link, done.
- Deep links work too: open `…/?code=XXXXXXXX` (or `…/#code=…`) and the box pre-fills itself.
- The dedicated `#/link` page still exists with device-name + retry messaging; the hero form forwards into it.
- Fixed a deploy bug where every asset returned **200 with an empty body** (the CORS re-wrap consumed the asset stream).

## ✦ How the protected build works

- `FreebuffClient-Loader.luau` (GitHub) is a 1 KB bootstrap: it fetches the current byte-verified payload from the build host and runs it.
- The payload is a single-file obfuscated build (`b64 + XOR keystream`); the decoded output is **byte-identical** to the source `Freebuff-Client.luau`.
- The full readable source also lives on the build host: `Freebuff-Client.luau`.

## ✦ Verification (2026-10-14)

| Artifact | Bytes | sha256 |
|----------|-------|--------|
| `Freebuff-Client.luau` (source) | 91,459 | `2e872a59cde87d5a…` |
| `FreebuffClient-Protected.luau` (build host) | 128,940 | `3b14431a06e57244…` |
| `FreebuffClient-Loader.luau` (GitHub) | 1,145 | `0d50c264bb406c3e…` |

- **Compile:** loader + source + protected build all compile clean under the official Luau compiler.
- **Published chain E2E:** GitHub loader bytes → build-host payload (fetched live, byte-match) → decode → `[FreebuffClient] loaded — F2 toggles · / opens the command palette`, exit 0.
- **Mock-executor driver:** 31/31 assertions — pages, composer, honest no-token, page switching, theme-switch regression, settings persistence, top-right close/minimize positions, resize grip in the corner, close-click tweens safely.
- **Website live-check:** `/`, `app.js`, `style.css` all non-empty (200), hero code box present in HTML, `heroForm` logic present in JS, `hero-code` styles present in CSS, `/api/health` OK.

## ✦ Keybinds

| Key | Action |
|-----|--------|
| `F2` | Toggle window (animated) |
| Drag titlebar | Move window |
| Drag `◢` corner | Resize window |
| `Enter` in composer | Send the message |
| `✔` status chip | Open Account |

## ✦ Real account login (in-app)

1. Account page → **Start linking** (or open the Login page directly)
2. An 8-character code appears (big copyable text)
3. Open the website (the code box is right there on the landing page) → enter the code → Confirm link
4. The app auto-links, refreshes your name/usage, and goes back to Chat

## ✦ Honest limitations

- Upstream **Freebuff** account/usage/models/chat endpoints remain unconfirmed in the backend config, so those fields show `Unavailable` instead of inventing numbers.
- Chat replies reveal at once after the full response arrives (`stream:false` — executor HTTP can't stream incrementally).
- In-game rendering/interaction (click targets, feel of the tweens) still needs your paste-and-run — the automated driver covers structure and logic only.

## ✦ Repo layout

```
├── FreebuffClient-Loader.luau   # 1 KB bootstrap → build-host protected build
├── docs/                        # API contract
├── freebuff-website/            # link-code website source (mirrored into the worker)
├── freebuff-backend/            # Cloudflare Worker API (device-link, sessions, website assets)
└── parts/                       # legacy v1 chunk set (unused by the v4 loader)
```
