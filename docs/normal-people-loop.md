# Normal-People Loop — 100 cycles (started 2026-06-11)

**Directive:** "continue make labaik usefull to normal people, find what have been done first, be brave think diffrent go big for the human future" + "search what's best in Claude Code, Codex, WorkBuddy etc."

**Plan:** approved 100-cycle roadmap (see `~/.claude/plans/before-continu-coding-can-polished-hedgehog.md`), built from a codebase workflow (3 explorers → 3 designers → 2 critics) plus a competitive-research workflow (6 web researchers → steal/differentiation strategists, June 2026 sources).

**Positioning:** *"All the AIs in one app, in your own language — no subscription, no account, and everything stays on your Mac."*

**Flagship bets:** 1) Paperwork Desk (Arabic-deep, tell-a-friend) · 2) Undo & Receipts (trust layer) · 3) Voice dictation, local-first · 4) Works Day One (zero-key) · 5) Narrow reliable agency (watchers + 3 guided errands behind dry-run/approve/undo).

**Rules:** one shippable tested improvement per cycle, committed to main; release every ~5 cycles; checkpoint every 25; eng-health ≤10 cycles; EN/中文/العربية on every new surface; agent state always visible; never pad — record dry wells honestly.

---

## Cycle log

### Cycle 1 — bridge timeouts: already shipped; residual fixed (2026-06-11)
- Plan item #1 (TODOS P2 "add timeout to `_bridge()`") turned out to be STALE:
  a 60s timeout has existed since v0.5.5 (commit 52813cb) covering all four
  bridges (browser-tool, screen-tool, mcp-call, mcp-list). The previous
  loop's lesson ("verify before building") caught it before a wasted cycle.
- Real residual found and fixed: the `_bridge` timer was never `unref()`'d
  (unlike `requestApproval`'s), so a pending 60s timer could hold the worker
  process open after the loop finished. Mirrored the approval pattern.
- Deleted the stale TODOS.md entry.

### Cycle 2 — zero-key first-run v1 (2026-06-11)
- Login reordered: "Start free & private" (🦙 local) is now the PRIMARY
  card; the API-key path drops to second with a "Smarter answers" badge
  and its form collapsed until clicked (toggleKeyForm already existed).
  A normal person can now reach a first reply without learning what an
  API key is.
- Hardware-honest fit pills (Jan-style) on every catalog model: new
  `system-info` IPC (RAM GB + arch) → `lmFitTier()` — "Fits this Mac" /
  "May be slow" / "Too big for this Mac" at 0.45/0.7 RAM fractions;
  Intel (CPU-only inference) demotes anything >2GB one tier.
- "✨ Recommended for your Mac" banner pinned atop the catalog for
  first-time users (hidden once any model is installed): best
  multilingual pick that comfortably fits — qwen3:8b → gemma4:e4b →
  gemma3:4b → llama3.2:3b → gemma3:1b.
- All copy in EN/中文/العربية; login.sub no longer leads with "your
  keys". 154 checks green (bridge-audit covers the new IPC pair).

### Cycle 3 — first-demo auto-prompt (2026-06-11)
- After a first-time user's model pull completes, `maybeFirstDemo()`
  selects the model, closes the modal + login screen, and auto-sends a
  localized demo message ("what can you help me with day to day?") —
  the first AI reply now happens with ZERO typing.
- Guards: fires once per install (`alaude:firstDemo:v1`), and only on a
  true first run — never if a cloud key was ever saved, a first reply
  already happened, any session has a user message, or a stream is
  active. Existing users can never be interrupted.
- Logs `first_demo_sent` to the OODA event log; `funnel_first_reply`
  then measures install→first-reply end-to-end. EN/中文/العربية.

### Cycle 4 — Undo v1: agent-write snapshots (2026-06-11)
- New `electron/undo-snapshots.js`: before ANY agent `write_file`, the
  pre-image is copied to `~/.labaik/undo/<turnId>/` (manifest + .bin
  bodies). First pre-image per file per turn wins; >10MB files are
  noted as too-large-to-undo rather than slowing the write; turn ids
  sanitized against traversal; pruned to 20 turns / 7 days.
- `restoreTurn(turnId)` puts every file back byte-identically (created
  files are deleted), capturing redo copies first so an accidental
  undo is itself recoverable from disk.
- Wired into the worker's write_file (never blocks the write). 7 unit
  tests — 161 checks total. The Cowork-11GB lesson: reversibility, not
  approval dialogs, is the trust unlock. UI lands next cycle.

### Cycle 5 — Undo v2: one-click rewind UI (2026-06-11)
- After any turn where the agent wrote files, a dismissible chip
  appears: "The AI changed N file(s) — Undo". One click restores every
  file from that turn's pre-images (created files deleted), reports
  "Put back N file(s)" (+ too-large skips), refreshes the file panel,
  and logs `undo_turn`.
- Same action in ⌘K: "Undo last file changes" — works any time within
  the 20-turn / 7-day snapshot retention window.
- New IPC pair `undo-list-turns` / `undo-restore-turn` (auto-covered by
  the bridge audit). Chip reuses the routine-nudge styling. All copy in
  EN/中文/العربية. 161 checks green. Bet 2's undo half is now LIVE
  end-to-end: snapshot → chip → byte-identical restore.

### Checkpoint — v0.7.73 RELEASED (2026-06-11)
- Cycles 1-5 shipped as v0.7.73: notarized + stapled arm64/x64 DMGs,
  GitHub release live, labaik.ai auto-updates within 60s. Tweet compose
  was permission-blocked; text handed to owner in-session.

### Cycle 6 — voice capture pipeline (2026-06-11)
- The real engine begins (webkitSpeechRecognition has no Electron
  backend — the v0.7.41 kill-switch reason). Renderer records mic audio
  via MediaRecorder (webm/opus, chunked-btoa) → new `voice-transcribe`
  IPC → `electron/voice.js` routes by key availability (openai → google
  → on-device later) with empty/size guards. Dev hook: `voiceDevTest()`.
  8 unit tests; 169 checks.

### Cycle 7 — Whisper engine (2026-06-11)
- `transcribeOpenAI()`: multipart whisper-1 upload on the user's own
  key, UI-locale 2-letter language hint (better short-clip Arabic and
  Chinese), 45s timeout, friendly error taxonomy (key-rejected /
  rate-limited / no-speech / stt-timeout / stt-network). Injectable
  fetch keeps tests hermetic — 7 more checks (175 total). Next: gate
  lift (mic button returns, capability-checked).

### Cycle 8 — VOICE IS BACK: gate lift onto the real engine (2026-06-11)
- `VOICE_ENABLED` const → capability check: the 🎤 button appears
  automatically when an OpenAI key exists (Gemini joins next cycle),
  refreshed at the central key-status point (checkLoginStatus).
- startVoice/stopVoice rewired from dead webkitSpeechRecognition onto
  the capture pipeline: click-to-talk and hold-Space push-to-talk both
  record → "Transcribing…" → text appends to the composer (PTT
  auto-sends). Esc cancels. Mic-denied error explains the exact System
  Settings path.
- Read-aloud TTS ungated — it's OS voices, zero network; it was
  collateral damage of the v0.7.41 kill-switch.
- Conversation mode stays HARD-OFF behind `CONVERSATION_MODE=false`
  until a VAD/endpointing cycle lands (without endpointing, auto-listen
  records forever — feasibility critic's catch).
- Tooltip discloses "uses your OpenAI key" (privacy honesty). Full
  error taxonomy + all strings in EN/中文/العربية. 175 checks green.
  Voice arc remaining: Gemini route, dictation QA, tests, local engine.

### Cycle 9 — Gemini STT route (2026-06-11)
- `transcribeGemini()`: inline-audio generateContent on the app's
  default flash model (temperature 0, transcribe-verbatim instruction,
  locale hint). Google-key-only users can now dictate. Same friendly
  error taxonomy; key goes in the x-goog-api-key header.
- Renderer capability mirrors voice.js routing (openai preferred,
  google fallback) and the mic tooltip now names the actual provider
  ("uses your {OpenAI|Google} key"). no-backend message updated ×3
  locales. 5 hermetic route tests — 180 checks green.

### Cycle 10 — kitchen-mode dictation hotkey (2026-06-11)
- ⌘⇧Space from ANYWHERE: main registers a global shortcut that shows +
  focuses Labaik and tells the renderer to start dictation; pressing it
  again stops, transcribes, and auto-sends (PTT semantics — hands stay
  in the dough). Esc still cancels.
- globalShortcut has no key-up events, so this is press-to-start /
  press-to-send rather than literal hold-to-talk; overlay copy says so
  ("press ⌘⇧Space again to send") in EN/中文/العربية. Registration
  failure (hotkey taken) degrades with a console note, never a crash.
- VOICE ARC CORE COMPLETE (cycles 6-10): capture → Whisper → gate lift
  → Gemini → global hotkey. 180 checks green. Next: Paperwork Desk.

### Checkpoint — v0.7.74 RELEASED + live QA (2026-06-11)
- "Labaik listens" shipped: notarized + stapled arm64/x64 DMGs, GitHub
  release live (first attempt rolled back on an upload 404; recreated
  release then uploaded assets individually — more resilient pattern),
  labaik.ai auto-updates within 60s.
- Live CDP-driven QA on a hermetic dev instance verified: login screen
  (free-local primary card, collapsed key form), voice gate lift (mic
  appears with honest provider tooltip the moment a key lands), undo
  chip + "Nothing to undo" path, and zero-key unblock via local Ollama.

### Cycle 11 — Paperwork Desk v1 (2026-06-11)
- New 📄 "Explain this letter" quick-start (4th template): clicking it
  opens the file picker immediately; once a letter/bill/form (photo,
  PDF, or doc) is attached, a structured prompt auto-sends — the answer
  arrives with zero typing, in the user's UI language even when the
  document is in another language.
- Card structure: What this is · Who sent it · What they want ·
  Deadline · What to do next. Cancelling the picker stages the prompt
  with a drop-hint toast (drag&drop + 📎 still work).
- `pickFile` is a general template capability (future document-first
  flows reuse it). EN/中文/العربية.

### Cycle 12 — Paperwork v2: draft my reply + print (2026-06-11)
- After any reply in a 📄 paperwork session, a chip offers the two
  things people actually do with an explained letter: ✍️ "Draft my
  reply" (one tap → short formal ready-to-sign letter in the
  RECIPIENT's language, with a translation below when that differs
  from the user's) and 🖨️ "Print".
- Print is real: new `print-html` IPC loads a clean serif document
  (dir=auto so Arabic letters print RTL) in a hidden window and opens
  the native macOS print dialog — which includes save-as-PDF. Elders
  trust paper; the loop's reality-check critic demanded this.
- Chip reuses undo-chip styling; 30s auto-hide; reappears after each
  reply (so after drafting, Print prints the draft). EN/中文/العربية.
  180 checks green.

### Cycle 13 — Paperwork v3: 🔔 remind me before the deadline (2026-06-11)
- Third chip action: extracts the date from the card's Deadline section
  (new tested module renderer/js/paperwork-dates.js — ISO, English both
  orders, Chinese 年月日, slashed with D/M-disambiguation, Feb-30
  rejection) and pre-fills the existing Routines Add form: reminder 3
  days before the deadline at 9am (clamped to tomorrow when closer;
  tomorrow when no date parses). User confirms with one click — nothing
  is created behind their back.
- The Paperwork loop is complete: drop → understand → reply → print →
  never miss the deadline. 14 unit tests; 194 checks green.

### Cycle 14 — Arabic depth + 🌐 Translate first-class (2026-06-11)
- Deadline extractor now reads dates the way Arabic documents write
  them: Arabic-Indic ٠-٩ / Eastern ۰-۹ digit normalization, and HIJRI
  dates (numeric forms, with/without هـ/AH, both slot orders) converted
  via tabular Islamic→Gregorian arithmetic (±1 day — fine for a 3-days-
  early reminder). ١٤٤٧/١٢/١٥ هـ in a government letter now sets a
  correct Gregorian reminder. 7 more unit tests (201 checks).
- AR paperwork starter deepened: dialect/officialese → clear simple
  fusha; Hijri deadlines stated in both calendars.
- 🌐 "Translate this" is a welcome-screen quick-start (the #1 everyday
  need the reality-check critic said must not be buried): paste/type/
  drop anything → translated into the UI language, with reply-back
  translation when the user pastes their answer. EN/中文/العربية.

### Cycle 15 — Receipts v1: the spend meter (2026-06-11)
- `computeMonthSpend()` walks every session's assistant messages this
  calendar month. Surfaced in two places: the topbar cost pill tooltip
  ("This month: $X") and a Receipts banner atop the 📈 model dashboard
  with the line no subscription vendor can ship — "Same usage on
  subscriptions: ≈ $20 × providers-you-used /month" + reply count.
- Soft spend alerts: one quiet toast per $5/$10/$20/$50/$100 threshold
  per month (localStorage-keyed by month).
- Confirm-before-expensive: Deep Research asks once per app run with a
  plain-words cost range before arming. EN/中文/العربية. 201 checks.

### Cycle 16 — Receipts v2: the network ledger (2026-06-11)
- New electron/net-ledger.js: an append-only, rotating, LOCAL record of
  every outbound call (host · why · when) at ~/.labaik/net-ledger.ndjson.
  Wired at the five call sites that carry user content: chat requests
  for every provider (incl. 🦙 localhost marked "stays on this Mac"),
  web search, fetch_page, voice transcription, Ollama installer.
- "Your data" panel (⌘K) grows a Network section: newest 25 calls with
  the honest headline — "🔒 All recent calls stayed on this Mac" on
  local models, or "☁️ N calls went to a cloud provider — on your own
  key, never through us." One-click Clear.
- The anti-Recall: privacy you can inspect, not just believe. 8 unit
  tests; 209 checks green. EN/中文/العربية.

### Checkpoint — v0.7.75 RELEASED (2026-06-11)
- "The Paperwork Desk" shipped: notarized + stapled arm64/x64 DMGs, all
  7 assets on GitHub (individual uploads — the resilient pattern),
  labaik.ai auto-updates within 60s. Session totals: cycles 1-16, three
  releases (0.7.73 / 0.7.74 / 0.7.75), 154 → 209 automated checks.

### Cycle 17 — quiet errors + no silent stalls (2026-06-11)
- Raw provider errors now collapse behind a localized "Show technical
  details" disclosure (token-based through renderMarkdown, re-escaped —
  no HTML rides along). This also FIXED an existing bug: the old
  <small> tag was being escaped and shown as literal text.
- Two new error classes: 🦙 Ollama-down (ECONNREFUSED on :11434 → "your
  local AI isn't running, open Local Models or pick a cloud model") and
  📡 offline (navigator.onLine false → "check your internet"), replacing
  the generic network message when they apply.
- Stall watchdog: if a turn is running but nothing has happened for 12s
  (no tokens, no tool activity), a soft pill appears — "⏳ Still working
  — slow models can take a while. Esc stops it." — and hides the moment
  life resumes. Cowork's top complaint (silence reads as broken) closed.
- EN/中文/العربية. 209 checks green.

### Cycle 18 — plain-words rename pass (2026-06-11)
- Permission modes now state their consequence as a human sentence in
  all 3 locales: "👁️ Observe — just looks, never changes anything" /
  "🛡️ Careful — asks me before any change" / "🌊 Flow — edits freely,
  asks before risky things" / "🚀 Autopilot — does everything without
  asking". Picker tooltip: "What Labaik may do in your folder without
  asking."
- EN "provider" → "AI service" across every user-visible error and the
  login footer (zh 服务商 / ar مزوّد were already everyday words and
  stay). "workspace" was already "folder" in all visible strings —
  verified, not re-shipped. 209 checks green.

### Cycle 19 — Settings hub v1: one front door (2026-06-11)
- New ⚙️ topbar button + ⌘, (the universal macOS settings shortcut) +
  ⌘K "Settings": one modal listing every settings surface as cards —
  AI services & keys, Local models, Reminders & routines, Snippets,
  Memory, Your data & privacy, Usage & spending, Backup & restore.
- Three inline rows handled right in the hub: 🌐 Language (one-tap
  EN/中文/العربية switch), 🎤 Voice status ("Ready — click 🎤, hold
  Space, or ⌘⇧Space anywhere" vs "needs a key"), 🎨 theme toggle.
- v1 is a launcher (cards open the existing modals); v2 migrates panes
  in fully. All names + descriptions ×3 locales. 209 checks green.

### Cycle 20 — natural-language reminders (2026-06-11)
- RE-SCOPE per quality floor: hub v2/v3 "migration" cycles dropped —
  cycle 19's launcher already solved discoverability; migrating panes
  buys a normal person nothing. Higher-impact items pulled forward.
- "remind me every friday at 5pm to pay the bills" — typed in the
  composer, in EN / 中文 / العربية — now opens the Routines form
  pre-filled (cron, task, name) instead of sending a model a request it
  can't actually schedule. Confident parses only (trigger word AND a
  recurrence): "remind me to call mom" still goes to the model. Nothing
  is created until the user presses Add.
- New tested module renderer/js/schedule-parse.js: weekly/daily/monthly
  recurrences, am-pm + 24h + 下午5点/点半 + الساعة ٥ مساء times,
  Arabic-digit normalization, task extraction. 12 unit tests; 217
  checks green.

### Cycle 21 — routine catch-up runs (2026-06-11)
- The fix for scheduled tools' #1 complaint: silent non-firing. If the
  Mac was asleep or Labaik closed when a routine should have fired, the
  scheduler now runs EXACTLY ONE catch-up for the most recent missed
  occurrence (7-day window) — the Claude Desktop pattern. Guards:
  createdAt (a routine created after today's slot doesn't retro-fire),
  lastRunAt (each miss made up once), disabled respected.
- Catch-up runs are labeled "↺ catch-up ·" in run history so the
  off-schedule fire explains itself. Paperwork deadline reminders are
  now sleep-proof. 7 unit tests; 228 checks green.

### BLOCKED — v0.7.76 release awaiting keychain (2026-06-11)
- The alaude-notarize keychain profile became unreachable mid-build
  (worked for v0.7.74/75 two hours earlier; login keychain likely
  re-locked). The 0.7.76 build is signed but NOT notarized — release
  held; v0.7.75 stays latest so users are unaffected. Owner action:
  unlock keychain / rerun, then rebuild + notarize + publish.

### Cycle 22 — Audio Overviews v1 (2026-06-11)
- ⌘K → "🎧 Listen to this": the current model writes a strict A:/B:
  two-host dialogue about the conversation (+ attached docs) in the UI
  language; the Mac's own voices perform it the moment it lands — two
  distinct voices (pitch-contrast fallback when only one exists),
  playback fully offline, Esc stops. Graceful fallback to plain
  read-aloud if the model ignores the A:/B: format.
- NotebookLM's one genuine normal-people hit, rebuilt local-first at
  near-zero cost: the script is just a chat turn; the audio never
  touches the network. EN/中文/العربية. 228 checks green.

### Cycle 23 — share as image (2026-06-11)
- RE-SCOPE: VAD/conversation-mode cycles deferred per the strategists'
  cut ("voice is an input method, not a destination; don't chase AVM").
  Pulled share-out forward instead — the reality-check critic's
  "missing" item: normal people's output channel is the family group
  chat, and its currency is pictures.
- ⌘K → "📤 Share last reply as image": the answer renders as a clean
  card (theme-aware, dir=auto for Arabic, tiny 'Labaik · labaik.ai'
  footer) in an offscreen window, is captured, and lands on the
  clipboard as a PNG — paste straight into WhatsApp/Messages/微信.
  New share-image IPC with size caps. EN/中文/العربية. 228 checks.

### Cycle 24 — Watchers v1: notify only when it changes (2026-06-11)
- A routine can now carry a 👁 watch URL: on each scheduled fire the
  page is fetched (https-only, ledger-logged, 3MB/15s caps), reduced to
  text, and hash-diffed against a snapshot. No change → quiet "👁 no
  change" history line, NO notification (the anti-feed-creep rule).
  Real change → the routine's prompt runs with before/after excerpts
  injected, and the normal notification fires.
- First check saves a baseline ("will notify when the page changes").
  UI: optional URL field in the routines form + a "Watch a page for
  changes" template (every 3h). Catch-up runs (cycle 21) make watchers
  sleep-proof too. 6 unit tests; 234 checks green. EN/中文/العربية.

### Cycle 25 — CHECKPOINT (2026-06-11)
- Fresh-install CDP audit, 11/11 live assertions green: settings hub
  (8 cards + 3 inline rows, ⌘,), Ollama-down error class + collapsed
  details disclosure rendering through markdown, NL reminder parser
  in-page ("…every friday at 5pm" → 0 17 * * 5), 5 welcome templates
  (📄 paperwork + 🌐 translate present), watcher URL field + 👁 template
  first in the gallery, audio/share/undo/remind functions live, mic
  correctly hidden on a keyless fresh home. Hub screenshot verified.
- Arc go/no-go: A done · B core done (local STT engine + Record mode
  remain) · C done · D receipts done (dry-run diffs pending, gates
  errands) · E hub done, panic-path pending · F watchers+catch-up done
  (template gallery partial) · G NOT STARTED (needs dry-run + guardrail
  trio first) · H not started · I partial (bridge timeouts, stall
  watchdog done; archive + Future-Console removal pending).
- Cycles 1-25 scorecard: 24 substantive ships + this checkpoint, 3
  releases live (0.7.73-75), 154 → 234 automated checks, two re-scopes
  honestly taken (hub migration, conversation mode). v0.7.76 release
  HELD on keychain access.

### Cycle 26 — Easy mode v1 (2026-06-11)
- One 🧓 switch in the settings hub: ~18% bigger everything (CSS zoom —
  scales the px-based layout uniformly, RTL-safe) and the power-user
  chrome disappears (plan-mode button, ⌘K hint chip, workspace file
  tree). Persisted across launches; toast confirms each flip; state
  shown in the hub row. The "set it up for someone you love" arc
  begins. EN/中文/العربية. 234 checks green.

### Cycle 27 — session archive (2026-06-11)
- Every session row gains a 🗂 button: archived conversations leave the
  main list and collect under a collapsed "🗂 Archived (N)" section at
  the sidebar bottom (▸/▾ toggle, ↩ to restore). Search still finds
  them — retrieval is retention. Live-verified via hermetic CDP
  (4/4 assertions: section count, hidden-when-closed, visible-when-
  open, scoping). Long-standing backlog item closed. EN/中文/العربية.
  234 checks green.

### Cycle 28 — Homework Tutor (2026-06-11)
- Dedup discipline: the Education space already existed but was
  TEACHER-facing (lesson plans, quizzes, grading). Instead of a
  duplicate space, it gains Homework Tutor mode: a Socratic guardrail
  in the system prompt — never hand over the answer first; probe what
  the student knows, teach the one concept, walk a SIMILAR example,
  let them attempt, hint; full solution only on explicit surrender,
  then explained step by step. Parents get coached on how to guide.
- Two student/parent quick actions at the top: 🧒 "Homework Help
  (won't just give answers)" and ✅ "Check My Work" — both accept a
  photo of the exercise. Space description/placeholder now lead with
  homework. 234 checks green.
