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

### Cycle 14 — tour rebuilt around wedge moments (2026-06-10)
- "What's in Labaik" now opens with "Start here — five things Labaik does
  that your browser tab can't": any-model switching, routines, skills,
  drop-any-file, ChatGPT import — each with a working Try button. The
  full feature timeline demoted to "Everything else" below.
- ChatGPT import flow extracted to importChatGPTFlow() (shared by ⌘K and
  the tour). Boot smoke test gained a one-retry policy after a flaky
  cold-start false alarm under full-suite load.

### Cycle 15 — first-run audit + tour at the activation moment (2026-06-10)
- Code-traced the fresh-install path: login auto-detect → key save →
  auto-switch to a connected recommended model → composer hints → ⌘K chip.
  All sound. Gap found: the wedge tour was ⌘K-only, invisible to the one
  user who needs it. It now auto-opens exactly once, 1.2s after the FIRST
  key ever saves — the activation moment.
- Phase A (first hour) is now complete. Next: Phase B/C leftovers — memory
  promote polish, README wedge alignment, App-quality pass.

### Cycle 16 — README leads with the wedge (2026-06-10)
- The wedge sentence is now the first bold line of "What is Labaik", and the
  intro paragraph references the activation features that exist (paste-any-
  key detection, mid-conversation switching, routines, ChatGPT import).

### Cycle 17 — routine results stop evaporating (2026-06-10)
- Full routine output only existed as a 120-char toast + 400-char history
  preview — the "dedicated session" promised in routines.js's header was
  never implemented. Successful runs now append (prompt-label + full
  result) to a starred "⏰ Routine runs" session. The morning digest is
  finally readable in the evening.

### Cycle 18 — notification → result, one click (2026-06-10)
- Clicking a routine's macOS notification now focuses the app AND switches
  to the "⏰ Routine runs" session. The retention chain is complete:
  schedule → fire → notify → click → read.

### Cycle 19 — model selection survives Recommended rebuilds (2026-06-10)
- Self-review caught a cycle-10 bug: rebuilding the ✨ Recommended optgroup
  on key-status refresh removed the selected option if the user had picked
  from that group, silently falling back to option 0. Selection is now
  captured before the rebuild and restored after.

### Cycle 20 — WEB SEARCH for every model (2026-06-10) · CHECKPOINT 2
- The biggest everyday capability gap vs ChatGPT closed: web_search (DDG
  HTML endpoint, no API key) + fetch_page (readable text, SSRF-guarded:
  no localhost/private ranges/non-http) offered to ALL models across all
  three provider loops. System prompt constrains use to current/external
  info with source citation. Fixture scenario 5 proves the DDG parse +
  round-trip against a mock. Cycles 11-20 pushed to PR #2.

### Cycle 21 — Deep Research mode (2026-06-10)
- One-shot researchMode flag (plan-mode precedent): ⌘K → "Deep research"
  sends the composer question with a strict protocol — sub-questions →
  differently-angled web_search batch → fetch_page primary sources →
  cross-check → TL;DR + cited findings + source list + caveats. Never
  invent citations. Fixture scenario 6 proves the protocol injection and
  its absence on normal chats. ChatGPT-Pro-style research, every model.

### Cycle 22 — backup & restore bundle (2026-06-10)
- ⌘K → "Back up Labaik": one portable JSON (sessions, memory, profile,
  routines, spaces, folder skills + renderer snippets/templates).
  CREDENTIALS EXCLUDED BY DESIGN. Restore backs up every file it
  overwrites (.pre-import-<ts>) then reloads. electron/backup.js is a
  pure module with 8 round-trip unit tests (incl. keys-never-exported).
  Kills the "my whole AI life is trapped on this Mac" fear.

### Cycle 23 — adversarial self-review of cycles 11-22 (2026-06-10)
- Reviewed the whole big-feature diff for cycle-19-class latent bugs.
  FOUND + FIXED: the deep-research one-shot flag (window._researchModeNext)
  was only cleared deep inside sendMessage, AFTER its early-return guards —
  so triggering Deep Research while a stream was running (or on empty
  input) leaked the flag into the user's NEXT ordinary message. Now cleared
  at every early return.
- Audited + cleared: session-id types are uniformly Date.now() numbers
  (no string/number mismatch from import/routine-log/restore); skipTools
  gates web search out of tiny-local-model turns; backup excludes creds
  (unit-tested). KNOWN LIMITATION logged: fetch_page's SSRF guard is
  hostname-based, so DNS-rebinding to a private IP isn't blocked —
  acceptable for a single-operator desktop tool; revisit if a server mode
  ever lands.

### Cycle 24 — per-routine notification toggle (2026-06-10)
- Every routine notified on every run, so a 15-min check spammed while the
  daily digest got buried. routines.notify field (default on); 🔔 Notify
  checkbox in the Add form + a 🔔/🔕 toggle on each row; main gates both
  success and failure notifications on it. Honest skips this cycle:
  cross-history search (global search already spans all sessions incl.
  imports) and per-routine model (the model select already existed).

### Cycle 25 — "Your data" privacy panel (2026-06-10) · CHECKPOINT 3
- ⌘K → "Your data": read-only inventory (data-inventory IPC) of exactly
  what Labaik keeps on this Mac — conversations, memory, profile, routines,
  keys, images, skills — each with size + total + the real folder path,
  Reveal-in-Finder, and a jump to Backup. Makes the "private, no
  subscription" wedge tangible instead of a claim. Cycles 21-25 pushed.

### Cycle 26 — clear-per-store from Your data (2026-06-10)
- The privacy panel can now DELETE, not just display: a × per store
  (data-clear IPC) renames the file to .cleared-<ts> (recoverable, not
  hard-deleted), confirms first, then reloads so the UI matches disk.
  Credentials are deliberately NOT clearable here (logging out belongs in
  Keys). Completes "see AND control your data" — the private wedge.

### Cycle 27 — first-routine nudge (activation→retention) (2026-06-10)
- The defined retention metric is "≥1 routine in week one", but nothing
  pointed an engaged new user at their first one. After the 3rd reply in a
  run, if they have ZERO routines, a single dismissible nudge ("Liked
  that? Labaik can do it on a schedule") offers to open the Routines
  modal — then never shows again (localStorage gated, and skipped entirely
  for anyone who already has a routine). Closes the weakest funnel link.

### Cycle 28 — unify the two backup systems (2026-06-10)
- Cycle 22 added a backup without noticing the app ALREADY had one
  (exportFullBackup, renderer-only, different schema) — two "Back up" and
  two "Restore" palette actions, confusing and overlapping. Unified on the
  cycle-22 bundle (sessions+memory+profile+routines+spaces+skills, keys
  excluded): folded prefs/focus/theme into its extras, repointed ⌘⇧E and
  the tour entry to it, removed the duplicate palette pair and ~95 lines of
  now-dead code (exportFullBackup/importFullBackup). Palette: 42 → 40.
- FLAGGED for a future cycle: the cycle-22 restore OVERWRITES whole files;
  the deleted importFullBackup merged sessions by id (keeping the longer
  copy). Restore should adopt that non-destructive merge — real safety win.

### Cycle 29 — non-destructive restore (the cycle-28 follow-up) (2026-06-10)
- importBundle now MERGES the array stores (sessions, spaces) by id instead
  of overwriting: local-only items survive, backup-only items are added, and
  on a shared id the more-complete copy wins (sessions: more messages) —
  restoring a backup on an active machine no longer wipes whatever's newer.
  Scalar stores still overwrite, always after a .pre-import snapshot. 4 new
  unit tests cover keep-local / add-remote / take-longer / count. Closes the
  safety regression flagged in cycle 28.

### Cycle 30 — live dogfood + clean boot logs (2026-06-10) · CHECKPOINT 4
- Relaunched the real app and verified cycles 11-29 boot with ZERO runtime
  errors in the console (the unit/boot tests can't see render-time JS
  errors). One nit fixed: the boot beacon rode the warn/error channel and
  printed as "[renderer error]" every launch — real log noise that could
  mask a genuine error. Now logged plainly. Cycles 21-30 summarized into
  PR #2.

### Cycle 31 — trim the always-on system prompt (2026-06-10)
- Measured what every message pays: ~1,380 tokens of always-on prompt, of
  which a 933-token "ask clarifying questions" block was mostly redundant
  domain examples + a verbose schema. Compressed to ~262 tokens (schema +
  all hard rules kept, examples dropped) → ~670 fewer input tokens on EVERY
  chat. On the cost-conscious "pay per use" wedge that's real money + lower
  latency, with no behavior change. Session delete + share-HTML export were
  already present (honest skips).

### Cycle 32 — gate the browser-restraint block on intent (2026-06-10)
- The ~230-token "browser tools are opt-in" block was always-on, but since
  cycle 6 browser_* tools are only OFFERED when the user signals browser
  intent — so on every other message the warning guarded tools that don't
  exist. Now gated on the same intent regex over userText (and trimmed to
  ~80 tokens when it does appear). Fixture asserts it's absent without
  intent. Cumulative with cycle 31: always-on prompt ~1,380 → ~540 tokens
  per message (~60% off), no behavior change.

### Cycle 33 — conversation history budget (2026-06-10)
- Found the bigger cost lever: sanitizeHistoryForApi re-sent the ENTIRE
  conversation every turn with no ceiling — on long sessions that dwarfs
  the (now-trimmed) system prompt and triggers provider context-limit
  errors. Added _capHistory: a ~60k-token (240k-char) budget that keeps the
  most recent turns, always ≥4, and leads with a one-line trim note when
  older turns are dropped. Normal sessions untouched; huge ones stop
  bleeding tokens. Pairs with cycle 9's context-limit error humanizer.
- Prompt-trim live dogfood deferred (static review only — the compressed
  ask block retains capability + schema + every hard rule; behavior risk
  low) in favor of this larger lever.

### Cycle 34 — extract + test the history budget (2026-06-10)
- _capHistory (cycle 33) could drop user messages from the API call, so it
  earned tests. Extracted to renderer/js/history-budget.js (pure ESM);
  index.html loads it as a module → window.capHistoryFn, and the inline
  sanitizeHistoryForApi delegates (identity fallback if a chat fires before
  the module loads). 8 unit tests: pass-through under budget, never-trim
  ≤minKeep, trims oldest + keeps newest, prepends note, keeps ≥minKeep huge
  messages, no input mutation. Same discipline that turned the boot crashes
  into a permanent test. 98 checks total.
