<p align="center">
  <img src="renderer/logo.jpg" width="96" alt="Labaik logo" />
</p>

<h1 align="center">labaik</h1>
<p align="center"><em>Every AI. One desktop.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" />
  <img src="https://img.shields.io/badge/windows%20%2F%20linux-coming%20soon-lightgrey" />
  <img src="https://img.shields.io/badge/electron-33-47848F" />
  <img src="https://img.shields.io/badge/node-18%2B-339933" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  <a href="https://labaik.ai">labaik.ai</a> ·
  <a href="https://github.com/alsayadi/alaude-desktop/releases/latest">Download</a> ·
  <a href="https://github.com/alsayadi/alaude-desktop/issues">Issues</a>
</p>

---

## What is Labaik

Labaik is a macOS desktop app that talks to every AI provider worth using — **Claude, GPT, Gemini, Grok, Kimi, Qwen, GLM, MiniMax, Hunyuan** — plus fully-offline **local models via Ollama**. One app, your API keys, no middleman, no monthly fee. Open-source under MIT.

The name `labaik` is Arabic for *"here I am — at your service."* That's the idea: a quiet desktop client that's wherever you need it, for whichever AI you want today.

---

## Why Labaik

| | |
|---|---|
| **No subscription** | $0 app fee. You pay only the providers you already have keys for — or pay nothing when you run local models. |
| **10 providers, one dropdown** | Anthropic · OpenAI · Google · xAI · Kimi (kimi.ai + kimi.com) · Alibaba Qwen · Zhipu GLM · MiniMax · Tencent Hunyuan · Ollama. |
| **Crew — multi-model in parallel** | Send one prompt to 2–4 models at once. Each replies in its own lane. Pick the best or have them debate. |
| **Skills — cron for AI** | Schedule Labaik to do things on its own. *"Summarize HN at 8am." "Draft standup at 6pm." "Ping prod every 15 min."* Results stream to a dedicated session. |
| **Built-in browser** | The agent can open URLs, read pages, fill forms, click buttons, take screenshots — all inside the app. |
| **Persistent memory + profile** | "Remember this" on any message. Profile = always-on facts about you. Memory = workspace-scoped, searchable with embeddings. |
| **Rich content display** | Real markdown, diffs, charts, Mermaid, SVG, file previews, artifacts. Whatever the model returns, the app renders it right. |
| **Tool calling + MCP** | Six built-in workspace tools (`read_file`, `write_file`, `list_directory`, `run_command`, `open_in_browser`, `start_dev_server`) plus full MCP server support. |
| **Privacy by construction** | No Labaik backend. Keys at `~/.labaik/credentials.json` mode `0600`. Prompts go machine → provider directly. Zero telemetry. |
| **Source-available, MIT** | Fork it, inspect it, ship your own build. |

---

## Current flagship models (as of v0.7.64)

| Provider | Flagship | Also ships |
|---|---|---|
| Anthropic | Claude Opus 4.7 | Sonnet 4.6 (default), Haiku 4.5 |
| OpenAI | GPT-5.4 | 5.4 Thinking, 5.4 Pro, 5.3 |
| Google | Gemini 3.1 Pro | 3 Flash, 3.1 Flash-Lite |
| xAI | Grok 4.20 Reasoning | 4.20 Non-Reasoning |
| Kimi (kimi.ai) | Kimi K2.6 | K2 Thinking Turbo |
| Kimi (kimi.com / CN) | Kimi K2.6 | K2 Thinking Turbo, Moonshot v1 128k |
| Alibaba DashScope | Qwen 3.6 Max Preview | Qwen 3 Coder Plus (1M ctx) |
| Zhipu | GLM-5 | GLM-5.1 (#1 SWE-Bench Pro) |
| MiniMax | MiniMax-M2.7 | |
| Tencent | Hunyuan Hy3 Preview | |
| Ollama (local) | Qwen 3.6 | Gemma 4, Llama 3.2/3.3, DeepSeek R1 |

---

## Download

Prebuilt binaries: [**Releases**](https://github.com/alsayadi/alaude-desktop/releases/latest). Developer-ID signed with hardened runtime.

| Platform | File |
|---|---|
| **macOS · Apple Silicon** (M1/M2/M3/M4) | `Labaik-<version>-arm64.dmg` |
| **macOS · Intel** | `Labaik-<version>.dmg` |
| **Windows** | coming soon (`NSIS .exe`) |
| **Linux** | coming soon (`.AppImage`, `.deb`) |

### First launch on macOS Sequoia

Until Apple notarizes the build, you'll see: *"Apple could not verify Labaik is free of malware."*

1. Click **Done** on the warning.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the **Security** section → click **Open Anyway** next to "Labaik was blocked".
4. Confirm with Touch ID / password.

One-time. After that, Labaik opens with a double-click.

---

## Run from source

```bash
git clone git@github.com:alsayadi/alaude-desktop.git
cd alaude-desktop
bun install         # or: npm install
bun start           # or: npm start
```

**Requires:** Bun or Node 18+, Electron 33 (auto-installed).

**Build locally:** `bun run build:mac` (or `build:win` / `build:linux`). Output in `dist/`.

---

## Where Labaik stores data

All under `~/.labaik/`:

| File | Contents |
|---|---|
| `credentials.json` | Provider API keys + OAuth tokens, mode 0600 |
| `sessions.json` | Chat history |
| `memory.json` | Scoped memory entries (with embeddings) |
| `profile.json` | Always-on profile facts |
| `skills.json` + `skill-history.ndjson` | Scheduled Skills + their run log |
| `spaces.json` | Custom Spaces |
| `permissions.json` | Per-workspace permission modes |
| `events.ndjson` + `ooda-state.json` + `ux-proposals.md` | Local-only OODA UX loop |

v0.7.64 consolidated everything into `~/.labaik/`. Legacy files under `~/.claude/` or `~/.alaude/` are read as a fallback and silently copied forward on first access — nothing is moved or deleted from the legacy locations.

---

## Project layout

```
alaude-desktop/
├── electron/
│   ├── main.js              IPC routing, credential storage, OAuth, windows
│   ├── api-worker.js        Spawned Node child process that talks to LLMs
│   ├── preload.js           contextBridge to window.alaude.*
│   ├── provider-registry.js PROVIDERS table + detectProvider/normalizeModelId
│   ├── paths.js             Canonical ~/.labaik/ paths + safe migration
│   ├── json-store.js        Atomic tmp+rename JSON persistence
│   ├── browser-agent.js     Built-in browser (CDP)
│   ├── mcp.js               MCP server manager
│   ├── ollama.js            Local runtime integration
│   ├── ooda.js              Local UX health loop
│   ├── permissions.js       Per-workspace permission modes
│   └── skills.js            Cron-for-AI runner
├── renderer/
│   ├── index.html           UI (chat, model picker, modals, Spaces)
│   ├── logo.jpg             The brand mark
│   └── js/                  Memory, profile, storage adapters, task-scope
├── build/
│   ├── icons/icon.png       App icon (macOS full-bleed forest tile)
│   └── entitlements.mac.plist
├── scripts/
│   ├── ad-hoc-sign.js       afterPack hook — fallback for dev builds
│   └── notarize.js          afterSign hook — Apple notarize + staple
├── labaik_design/           Brand system source (logos.jsx, design canvas)
└── package.json             electron-builder config + signing identity
```

---

## License

[MIT](LICENSE). Fork it, ship it, do what you want.

Built by [Ahmed Alsayadi](https://github.com/alsayadi).
