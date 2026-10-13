# 🐃 Freebuff — Protected Luau Build

One-paste loader for the **protected build** of the Freebuff Desktop app recreation (full AI desktop shell: chat, AI builder, files, terminal, models, settings).

## ✦ Install (one paste)

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/Rolandthehacker67/freebuff.lua/main/Freebuff-Protected.luau"))()
```

Right-Ctrl toggles the window. No setup, no credits — the default AI engine is the keyless `text.pollinations.ai` endpoint; Claude / OpenAI / Gemini / DeepSeek / Groq / Ollama and real Freebuff device-code login are all available in-app.

## ✦ How the protected build works

- `Freebuff-Protected.luau` is a tiny loader. It fetches the payload in **17 chunks** (`parts/p1.lua` … `parts/p17.lua`), strips all whitespace, **base64-decodes, XOR-unmasks and LZW-decompresses** the result, and runs it with `loadstring` — the full app source never appears in the repo.
- The payload was produced by a compressor that keeps the decoded output **byte-identical** to the verified `Freebuff-AllInOne.luau` build (95,701 bytes; sha256 `02d30f7a…2be61f66`).
- Every chunk is a line-wrapped base64 blob (100 chars/line) and was committed with its **git blob sha verified byte-for-byte** against the build, so runtime decode determinism is guaranteed.
- Loader failure messages are fail-loud: if any chunk is missing or any decode step fails, it errors immediately instead of running a half build.

## ✦ Repo layout

```
├── Freebuff-Protected.luau   # small loader (fetch → strip → b64 → XOR → LZW → run)
├── parts/p1.lua … p17.lua    # chunked LZW payload (whitespace-wrapped base64)
└── README.md
```

## ✦ Keybinds

| Key | Action |
|-----|--------|
| `RightCtrl` | Toggle window (or use the 🐃 pill) |
| `Enter` in chat/terminal input | Send |
| Titlebar `–` / `×` | Minimize to pill / close |

## ✦ Verification

- Decode roundtrip: part bytes fetched from this repo → strip whitespace → concat → base64 → XOR → LZW decode → **95,701 bytes, sha256 `02d30f7a…2be61f66`** — byte-for-byte identical to the verified build.
- Loader blob sha `06470a80…` and all 17 part blob shas (`a982c0f3`, `04864a8c`, `cb2aa815`, `8b8df4a6`, `abc8d009`, `eeb2422d`, `485ad317`, `76277db2`, `0140712e`, `5e7d6d4b`, `b787c9b3`, `fa6181d2`, `b88f3fab`, `338725e9`, `30255428`, `aa4dba94`, `004a347d`) verified exact against local build artifacts.
- Compile: **PASS** with the official `luau` compiler (`--!nocheck` header on the loader).
- AI endpoint: live-tested keyless (`text.pollinations.ai`, HTTP 200).
