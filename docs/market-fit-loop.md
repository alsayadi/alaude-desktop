# Market-Fit Loop — rethink Labaik: simple, focused, findable fit

Loop target (set 2026-06-10): **100 cycles** on product simplification and
market fit. Same rules as the general-use loop: one real improvement per
cycle, no padding, honest course-corrections, ship checkpoint every ~10.
Predecessor: docs/general-use-loop.md (10 cycles, shipped separately).

## Cycle 1 — The Rethink

### What Labaik actually is (the wedge)

One sentence: **the fastest way to use any frontier AI on your Mac with your
own keys — private, no subscription.**

That sentence is the entire product. Evidence it's the right wedge:
- 11 providers + local Ollama behind one dropdown is genuinely rare done well.
- BYOK + no backend + keys-on-disk is a real privacy/cost story vs. five
  $20/month subscriptions.
- The macOS-native, consumer-polished shell differentiates from dev-tools
  (Claude Code, Codex) and from rough local-first clients (Jan, LM Studio).

### Who it's for

The **AI power-consumer**: uses AI daily, has (or will get) an API key,
resents subscription stacking, cares where their data goes. Often technical
but NOT necessarily a programmer — the general-use loop already proved the
app serves writers, analysts, teachers, marketers.

NOT the target: enterprises (no admin/SSO), hardcore devs (Claude Code owns
that), people who will never touch an API key (they need OAuth or bundled
credits — a later experiment, not now).

### The simplicity problem (measured)

- 34 modal overlays, 11 toggle*Modal functions, ~24k lines in 3 files.
- Surface inventory: Spaces, Crew, Council, Screen Vision, browser agent,
  health toolset, voice (disabled), thinking map, UX insights, heatmap,
  digest, model perf, memory lens, task scope, quick window, future console,
  plan mode, routines, skills, snippets, subagents, @ mentions…
- A new user meets ALL of this chrome while the wedge needs exactly:
  key → model → chat. Everything else is progressive disclosure.

**Doctrine for all 99 remaining cycles: the wedge gets chrome; everything
else lives in ⌘K.** Visible UI surface must justify itself by serving
first-session value; power features are palette-reachable, not topbar-furniture.

### Feature triage (initial; revisit at checkpoints)

- **CORE (visible chrome):** chat, model picker (+✨ Recommended), keys,
  attachments/drop, sessions sidebar, stop button, routines (the retention
  hook), memory (silent, with one promote affordance).
- **POWER (⌘K only):** crew/council, spaces, browser agent, skills install,
  snippets manager, thinking map, plan mode, subagents (model-invoked anyway).
- **DEMOTE/CUT candidates (audit each in its own cycle):** Future Console
  (ships dark — cut from menus until designed), UX insights/heatmap/digest/
  model-perf modals (4 analytics modals nobody asked for — merge or hide),
  Screen Vision entry points (high wow, high risk — opt-in deep setting),
  quick window (validate or cut), health tools (keep but space-gated, as is).

### Market-fit definition (what "finding fit" means here)

Activation: fresh install → first model reply in **under 60 seconds**.
Retention hook: ≥1 routine or ≥1 reused skill/snippet in week one — the
reasons Labaik opens tomorrow. The local OODA telemetry already measures
turn success/latency; cycles will add (local-only) activation funnel marks.

### Roadmap (feeds cycles 2–100)

- **Phase A — First hour (cycles ~2–15):** boot smoke test (carried over —
  two boot crashes proved the need); first-run audit + time-to-first-reply
  measurement; login screen → single "paste any key, we'll detect the
  provider" field; demote the DEMOTE list out of topbar/menus; one Settings
  hub to collapse the modal zoo.
- **Phase B — Core loop sharpness (16–40):** chat ergonomics polish, model
  switching mid-conversation, attachment flows, memory promote UX, routine
  creation from any message ("make this a routine").
- **Phase C — Tell the story (41–70):** README/site copy aligned to the
  wedge sentence; in-app "what's possible" tour rebuilt around 5 wedge
  moments; default templates per persona; App-quality pass (icons, motion).
- **Phase D — Retention + distribution experiments (71–100):** routine
  outcome notifications, weekly digest routine pre-armed, import from
  ChatGPT/Claude export, share-a-session artifact.

## Cycle log

### Cycle 1 — this document (2026-06-10)
- Wedge defined, target user named, simplicity doctrine set
  ("wedge gets chrome; everything else lives in ⌘K"), triage lists drawn,
  activation/retention metrics defined, 4-phase roadmap laid out.

### Cycle 2 — boot smoke test (2026-06-10)
- Boot beacon as the main script's last statement + scripts/test-boot.mjs:
  launches the REAL app hermetically (LABAIK_HOME + LABAIK_USERDATA temp
  dirs so it can't fight the user's running instance over the LevelDB
  lock), waits ≤30s for the beacon, kills the instance. ~1.3s in practice.
  Chained into npm test. Closes the gap that let two boot crashes ship.

### Cycle 3 — Future Console demoted to ⌘K (2026-06-10)
- Removed the tray item and File-menu entry (+⌘⇧F accelerator). The
  experimental cockpit is now reachable only via ⌘K → "Future Console
  (experimental)". First application of the doctrine.

### Cycle 4 — analytics demoted from topbar (2026-06-10)
- "UX insights" and "Thinking map" left the topbar ⋯ menu (palette entries
  already existed; heatmap/digest/model-perf were palette-only already).
  Topbar menu is now: search, crew, routines, keys, local models — all
  wedge-aligned.

### Cycle 5 — paste-any-key login (2026-06-10)
- Login defaults to "✨ Auto-detect": pattern fast-paths (sk-ant→Anthropic,
  AIza→Google, xai-→xAI, JWT→MiniMax, id.secret→Zhipu) and parallel
  /models probing for the ambiguous sk-… family (OpenAI/DeepSeek/Kimi/
  Moonshot/Qwen/Hunyuan) — first authenticated 200 wins. Manual dropdown
  stays as fallback. Directly attacks the <60s activation metric.

### Cycle 6 — screen-control tools gated on intent (2026-06-10)
- SCREEN_TOOLS (click/type/keystroke on the user's real desktop) were
  offered to the model in EVERY chat. Now gated behind screen intent in
  the latest user message — same pattern as browser/image tools — in all
  three provider loops. Fixture asserts normal chats carry zero screen_*
  tools. (Screen Vision UI chrome was already hidden; ⌘⇧V still works.)

### Cycle 7 — activation funnel marks (2026-06-10)
- Settings hub SKIPPED honestly: after cycle 4 the ⋯ menu already is the
  hub (search/crew/routines/keys/local models) — a gear redesign would be
  churn. Instead: local-only funnel marks funnel_install → funnel_key_saved
  → funnel_first_reply (with sinceInstallMs) into the existing OODA event
  log. The <60s activation metric is now measurable on real installs.

### Cycle 8 — routines notify natively (2026-06-10)
- Routine results only showed as an in-app toast — invisible whenever the
  app was unfocused, which is exactly when scheduled work runs. Success and
  failure now post real macOS notifications (click → focus app) when the
  window isn't focused. First Phase D retention hook, pulled forward.
- Quick window triage decision: KEEP — spotlight-style access serves the
  wedge directly.

### Cycle 9 — turn last prompt into a routine (2026-06-10)
- ⌘K → "Turn last prompt into a routine" prefills the Routines Add form
  (auto-name, prompt text, daily 8am default). The bridge from a good
  one-off prompt to the week-one retention metric.

### Cycle 10 — wedge copy on the front door (2026-06-10) · CHECKPOINT
- Login subtitle now states the wedge: "Every frontier AI on your Mac —
  your keys, private, no subscription." (EN/中文/العربية.)
- Checkpoint 1 of 10: cycles 1-10 pushed. Score so far: 1 strategy doc,
  1 test layer (boot smoke), 2 demotions, 1 safety gate (screen tools),
  1 activation feature (paste-any-key), funnel metrics, 2 retention hooks.

### Cycle 11 — ChatGPT history import (2026-06-10)
- ⌘K → "Import ChatGPT history": picks conversations.json from a ChatGPT
  data export, linearizes each conversation's mapping tree (current_node →
  parent walk), and merges them as 📥-prefixed sessions. Converter is a
  pure module (electron/import-chatgpt.js) with 5 unit tests. Switching
  cost is THE adoption barrier for the target user — this lowers it.

### Cycle 12 — routine run history (2026-06-10)
- Routines modal gains a "Recent runs" section (last 20, status icon, time,
  preview) backed by routines.history() reading the ndjson tail + a
  routines-history IPC. Builds trust that scheduled work actually ran.
- Honest skip: session export (markdown + HTML) already existed in ⌘K.

### Cycle 13 — Run now on routines (2026-06-10)
- ▶ button per routine fires it immediately through the exact same path as
  the cron scheduler (fireRoutine extracted in main; routines-run-now IPC).
  Kills the "save it, then wait until 8am to find out it's broken" loop —
  result lands in Recent runs within seconds.
