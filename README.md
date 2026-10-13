# 🐃 Freebuff — Protected Luau Build

One-paste loader for the **protected build** of the Freebuff Desktop app recreation (full AI desktop shell: chat, AI builder, files, terminal, models, settings).

## ✦ Install (one paste)

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/Freebuff-Protected.luau"))()
```

Right-Ctrl toggles the window. No setup, no credits — the built-in Freebuff engine runs keyless through its relay endpoint, and **real freebuff.com device-code login** (same flow as the CLI) is available in-app for a live session + Freebucks balance.

## ✦ How the protected build works

- `Freebuff-Protected.luau` is a tiny loader. It fetches the payload in **17 chunks** (`parts/p1.lua` … `parts/p17.lua`), strips all whitespace, **base64-decodes and LZW-decompresses** the result, and runs it with `loadstring` — the full app source never appears in the repo.
- The payload was produced by a compressor that keeps the decoded output **byte-identical** to the verified `Freebuff-AllInOne.luau` build (**93,260 bytes; sha256 `72588105…db618bda`**).
- Every chunk is a line-wrapped base64 blob (100 chars/line) committed with its **git blob sha verified byte-for-byte** against the build (17/17 pass), so runtime decode determinism is guaranteed.
- Loader failure messages are fail-loud: if any chunk is missing or any decode step fails, it errors immediately instead of running a half build.

## ✦ Repo layout

```
├── Freebuff-Protected.luau   # small loader (fetch → strip → b64 → LZW → run)
├── parts/p1.lua … p17.lua    # chunked LZW payload (whitespace-wrapped base64)
└── README.md
```

## ✦ Real account login (in-app)

Same device-code flow the real CLI uses (all endpoints verified live):

1. `POST freebuff.com/api/auth/cli/code` → `{fingerprintId, fingerprintHash, loginUrl, expiresAt}` (1-hour expiry)
2. The UI copies the login URL → open it in any browser → sign in with GitHub
3. The script polls `GET /api/auth/cli/status?…` → the **real user object** (`{id, name, email, authToken, …}`) comes back
4. Token verified against live `www.codebuff.com/api/v1/me` (401-confirmed auth-gated); Freebucks usage via `POST /api/v1/usage`
5. Credentials saved to the executor workspace as `Freebuff/session/credentials.json` (same shape as the real CLI) and restored on next load

## ✦ Keybinds

| Key | Action |
|-----|--------|
| `RightCtrl` | Toggle window (or use the 🐃 pill) |
| `Enter` in chat/terminal input | Send |
| Titlebar `–` / `×` | Minimize to pill / close |

## ✦ Verification

- **Blob shas:** loader `06470a80…` + all 17 payload parts (`eba4c8cc…` `d30aefbf…` `691f5af2…` `258844dd…` `f7a06f81…` `c838de16…` `85052a61…` `9168a55f…` `f8125215…` `d7e8f4b5…` `2fe0501e…` `d9a2e238…` `4786b7f5…` `7dc3fc07…` `b2bf3fe9…` `a33d2cb9…` `b8474350…`) — every commit byte-exact, 17/17.
- **Decode roundtrip:** part bytes → strip whitespace → concat → base64 → XOR keystream → 12-bit LZW (with full dictionary rebuild on the flush code) → **93,260 bytes, sha256 `72588105300e3e6882a3b93b74be5abd16e08e61f782fa6da6d213f8db618bda`** — byte-for-byte identical to the compiled `Freebuff-AllInOne.luau` build. Separately confirmed in the real Luau interpreter (official `luau` runtime, not just Python).
- **Compile:** PASS with the official `luau` compiler (`--!nocheck` header on the loader).
- **AI endpoint:** live-tested keyless (`text.pollinations.ai`, HTTP 200).
- Remaining limitation: no Roblox client in this VM — in-game runtime (instance rendering, executor HTTP shim detection) still needs a paste-and-run in your executor.
