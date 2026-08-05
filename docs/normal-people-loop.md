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

### Cycle 29 — the panic path (2026-06-11)
- A small always-there 🛟 button (bottom corner, RTL-aware via
  inset-inline-end, larger + more visible in Easy mode) opens a
  plain-words rescue menu for the moment of confusion: ⏹ stop what
  it's doing · ↩︎ undo the AI's file changes · 🧹 fresh conversation
  (nothing deleted) · ⚙️ Settings · ❓ what can Labaik do. Click-away
  and Esc close it. Every action reuses an existing safe path — the
  critic's "what does a confused person do?" gap closed.
  EN/中文/العربية. 234 checks green.

### Cycle 30 — Future-Console entry removed + wedge tour refreshed (2026-06-11)
- The 🛸 "Future Console (experimental)" palette entry is gone — an
  unfinished cockpit with a discoverable entry invites confusion
  (TODOS P3). Window code stays dormant pending a productize/cut call.
- "What can Labaik do?" now showcases this loop's tell-a-friend set:
  📄 explain a scary letter (opens the Paperwork flow), 🎤 talk instead
  of type, ↩︎ undo anything the AI did, ⏰ reminders in plain words
  (pre-fills a live example), 🔒 free/private/inspectable (opens Your
  Data). Older wedges remain in the timeline. 234 checks green.

### Cycle 31 — restore-merge complete: restore can ADD, never REMOVE (2026-06-11)
- The union-by-id restore (cycle 29: sessions+spaces) now covers ALL
  id-array stores: memory entries, profile entries, routines. Local
  wins on id conflict; restore between two active machines can only
  add, never silently wipe. Profile's `onboarded` flag never regresses
  (a restore must not re-trigger the first-run questionnaire).
- Closes the long-flagged safety debt and unblocks Care bundles
  ("set up for someone you love" applies a starter bundle via this
  merge-safe path). 6 unit tests; 240 checks green.
- NOTE: v0.7.76 tag+release rolled back per owner policy — no releases
  until cycle 100; public latest remains v0.7.75.

### Cycle 32 — Care bundle: set up Labaik for someone you love (2026-06-11)
- ⌘K → 💝 "Set up Labaik for someone you love": pick their language,
  Easy mode, and caring reminders (💊 daily meds at 9 AM, 💳 monthly
  bills check) — reminder text ships in the RECIPIENT's language. Saves
  one small setup file containing NONE of the giver's data (new
  care-export IPC validates the bundle shape).
- Recipient applies it via the normal merge-safe Restore: routines
  merge in (cycle 31), language + Easy mode apply on reload, and a
  "💝 set up with love" toast greets them. The adult-child-installs-
  it-for-a-parent growth channel, productized. EN/中文/العربية.
  240 checks green.

### Cycle 33 — SKILL.md open-standard interop (2026-06-11)
- Agent Skills became an open standard with a large ecosystem;
  folder-skills discovery now also reads other tools' USER-LEVEL skill
  dirs (Claude Code's ~/.claude/skills) — strictly read-only, tagged
  source:'claude', Labaik-native wins on slug collision. use_skill and
  the slash menu resolve interop skills identically.
- Under LABAIK_HOME the standard root redirects into the sandbox
  (mirrors paths.js legacy handling) so fixtures never touch real user
  data. get() traversal guard hardened (.. rejected). 3 unit tests;
  243 checks green.

### Cycle 34 — Homework Tutor made visible (2026-06-11)
- Honesty catch: SPACES_ENABLED=false means the entire spaces UI
  (cards, picker, quick actions) is hidden — so cycle 28's Education
  guardrail was UNREACHABLE, and the planned "localize spaces" cycle
  would have polished an invisible surface. Both re-scoped.
- 🧒 "Homework helper" is now the 6th welcome template (grid: 2 clean
  rows of 3): pickFile flow — photo the exercise → Socratic contract
  embedded inline in the starter (ask what I know → teach the one
  concept → similar example → let me try → hints; full solution only
  on surrender). No hidden space-state switching. The space-level
  guardrail stays for whenever spaces return. EN/中文/العربية.
  243 checks green.

### Cycle 35 — the survival guarantee (2026-06-11)
- "Your data" gains a final section: 🎒 "Take everything & leave — any
  time": no account, no lock-in; everything lives in ~/.labaik and the
  plain-JSON backup; the complete exit recipe (backup → delete folder →
  trash the app) is printed right inside the app. Dot's shutdown and
  stealth model downgrades elsewhere are the market backdrop — an app
  that shows you the exit door is one you can trust to stay.
  EN/中文/العربية. 243 checks green.

### Cycle 36 — the model refresh: current everywhere, and nothing dead (2026-08-02)
- Owner request ("the providers added new models, support them"). Three
  parallel research agents verified every provider's current lineup
  against official docs rather than trusting the ids already shipped.
- **New models added.** Anthropic: the Claude 5 family (Sonnet 5 as the
  daily driver, Opus 5 flagship, Fable 5 most-capable; there is no
  Haiku 5, so Haiku 4.5 stays the cheap tier). OpenAI: GPT-5.6's three
  named tiers — Sol / Terra / Luna. Google: Gemini 3.6 Flash + 3.5
  Flash-Lite (3.1 Pro is still the newest Pro tier). xAI: Grok 4.5, 4.3
  (1M ctx), Build 0.1. Kimi K3, Qwen 3.7 max/plus/flash + Coder Next,
  GLM-5.2/5-turbo/4.7, MiniMax-M3, Hunyuan hy3. Local: Gemma 4 12B,
  Liquid LFM2.5 8B, Ornith 1.0 9B/35B, MiniCPM-V 4.6.
- **Dead ids removed** — these were shipping and would error on click:
  `deepseek-chat` / `deepseek-reasoner` (retired 2026-07-24, they now
  hard-error rather than falling back), `glm-5-air` and bare `glm-4`
  (never on any Zhipu list), `kimi-k2-thinking-turbo` (K2 discontinued
  2026-05-25), and `gpt-5.5-thinking` / `gpt-5.5-mini` /
  `gpt-5.4-thinking` — reasoning became a request *parameter* on
  GPT-5.6, so those ids never existed upstream at all.
- **Routing bugs fixed.** The `hy4-` prefix matched a Hunyuan generation
  that was never made; worse, the `hy3-` prefix silently missed the bare
  flagship id `hy3` and fell it through to Anthropic. Hunyuan also moved
  to TokenHub — the old api.hunyuan.cloud.tencent.com host shuts down
  2026-09-30. And the Anthropic group shipped an option with an EMPTY
  value that blanked the session model on selection.
- **Pricing is now real.** The old table was openly guessed ("assumes
  OpenAI follows their usual tier ratios"). Every current-generation row
  is the provider's own published list price, including the Jul 30
  OpenAI cut. Sonnet 5's introductory $2/$10 is encoded as a DATE so the
  spend meter stops under-reporting on Sep 1 instead of quietly lying.
- **Cost tier derived from price, not from the name.** Caught live, not
  by tests: the old name-regex scored `gpt-5.6-luna` — OpenAI's cheapest
  model — as 🔴 premium, because "gpt-5." pattern-matched a flagship.
  Tiers now bucket on published output $/Mtok, so they stay honest on
  their own. Fallout worth knowing: Gemini's Flash tier is no longer
  cheap ($7.50/Mtok out) and now correctly reads 🟡 mid.
- **Completeness pass** (owner asked "are you sure you included all new
  models"): the first pass had in fact missed eight that the research
  confirmed — Gemini 3.5 Flash, GLM-4.7-Flash (which is FREE, the single
  most valuable omission for a no-subscription app), Kimi K2.7 Code
  High-Speed on both endpoints, Claude Opus 4.8, Grok 4.20 multi-agent,
  Hunyuan Vision 2.0 and Role, and Nemotron 3 locally. All added; the
  picker went 58 → 66 models. Deliberately still excluded, with reasons
  recorded in the markup: `claude-mythos-5` (invite-only, would 404 for
  almost everyone), `qwen3.8-max-preview` (subscription-only, no
  pay-per-token), and the colon-less local releases (north-mini-code,
  laguna-xs) that the Ollama `name:tag` routing check cannot see.
- A free cloud model now reads 🟢 **free**, not merely "cheap" — GLM-4.7
  Flash is the one tier a user with no money at all can run forever.
- New test section [21/21] asserts the whole invariant set: every picker
  option routes to its own optgroup's provider, has a price, and is not
  on the retired list; no empty values; MiniMax keeps its case; tiers
  land where they should; and a MUST_HAVE list guards that every current
  flagship is actually present — the miss the completeness pass caught
  is now impossible to repeat silently. 258 → 264 checks green.

### Cycle 37 — models without a rebuild (2026-08-02)
- Owner question after the cycle-36 refresh: "any way to load them async
  without updating the client?" The answer splits cleanly — model IDS can
  be discovered live; PRICES cannot, because no provider exposes pricing
  programmatically.
- Rejected the obvious option: a remote catalog served from labaik.ai
  would give full fidelity with no rebuild, but it is a phone-home on
  every launch and it makes the app depend on a domain staying alive —
  which directly contradicts the survival guarantee printed into the app
  in cycle 35. Not worth trading a permanent promise for a few days of
  freshness.
- Shipped the hybrid instead. `electron/model-discovery.js` asks each
  provider the user ALREADY has a key for what that key can see, on the
  user's own credentials, cached 24h on disk. No backend, no manifest, no
  new privacy surface; every call lands in the net-ledger like any other.
  Anthropic and Google need their own auth shapes and Google namespaces
  ids as `models/…`; everything else speaks the OpenAI `/v1/models` form,
  which the provider-registry baseURLs already supply.
- The response is filtered hard: `/v1/models` returns the provider's whole
  catalogue (OpenAI answers with ~80 entries — embeddings, TTS, image,
  moderation, `babbage-002`). Unfiltered it would make the picker worse,
  not better. Anything unrecognised lands in a "🔎 Other models your key
  can use" group above Local, so curated ordering is never disturbed.
- **Honest pricing beats guessed pricing.** Discovered models carry no
  price, so they render "price unknown" with a ⚪ badge rather than a
  fabricated number. Live testing then exposed a related bug that had
  been latent for releases: longest-prefix matching let `gpt-5.7-nova`
  inherit the `gpt-5` row's price. Prefix matches now require a `-`
  boundary, so variants and dated snapshots still resolve
  (`gpt-4o-mini-2024-07-18`, `gemini-3.1-pro-preview`) while a version
  bump correctly falls through to unknown.
- Testing note worth remembering: `window.alaude` is frozen by
  contextBridge, so the discovery response CANNOT be stubbed from the
  page. Rather than leave the browser half unverified, the decision logic
  moved to `renderer/js/model-extras.js` (matching schedule-parse.js and
  friends) where it is directly testable — and the DOM half was then
  verified live by stubbing that plain module object.
- Residual, stated plainly: discovery removes the hard block, not the
  curation. A brand-new model is now selectable the day it ships, but its
  label, ordering and price still arrive with the next build.
  264 → 291 module checks (295 total).

### Cycle 38 — "less is more": the chat window redesigned (2026-08-02)
- Owner: "redesign the ui and chat window, look at what new in claude,
  learn from it" + "'less is more' philosophy". Researched where Claude's
  own interface landed in 2026 (measured DOM + 2026 announcements), then
  took only the ideas that survive the second instruction.
- **Removed the Google Fonts dependency.** The renderer had been pulling
  Inter / Instrument Serif / IBM Plex Mono from fonts.googleapis.com on
  every single launch — render-blocking, ~180KB, and a third-party
  request in an app whose entire promise is that nothing leaves the Mac.
  It also fell back to system faces offline anyway. macOS already ships
  better: SF Pro, New York, SF Mono. One deletion bought privacy, cold
  start and a more native feel at once.
- **Identity by layout, not by label.** The uppercase "YOU" / "LABAIK"
  captions are gone. Labaik's reply is now bare full-width text set in a
  reading SERIF; your message is a sans bubble that hugs its own text at
  the end of the line. A reply reads like a letter rather than a chat
  log, and you can still tell instantly who is speaking. `--serif-read`
  is its own variable, so the face reverts to sans in one line.
  `align-items: flex-end` is direction-aware — Arabic RTL mirrors with
  no extra rule (verified live).
- **Two type sizes, held to.** 16px for anything a person reads, 14px
  for every control around it. Much of the old noise was six sizes
  competing. Mode chips under the composer lost their borders and fills
  and earn them back on hover; the risky permission modes keep their
  warning colour, because that is a safety signal, not decoration.
- **Kept deliberately, against Claude's pattern:** the per-message model
  badge. Claude shows the model once because a thread uses one model.
  Labaik can answer from any of 66, so which one replied is information.
- **Pre-existing bug found while looking, not searched for:** the rule
  `.msg-content code, .msg-content .md-img { … display:block; margin:8px 0;
  cursor:zoom-in }` was a typo for `img`. Every inline `code` span in
  every reply had been rendered as an image — forced to its own block,
  bordered, with a zoom cursor — so any sentence containing inline code
  was split into three pieces down the page. Removed; inline code now
  falls through to `.md-code` where it belongs.
- Verified live in a hermetic instance: serif 16px/26.4px assistant, sans
  bubble user, 768px column, 0 remote font requests, dark mode inverting
  correctly, RTL mirroring. New test section [23/23] locks the offline
  invariant and the inline-code regression. 291 → 304 module checks
  (308 total).

### Cycle 39 — the composer's "+" menu (2026-08-02)
- Finishes what cycle 38 left as the stated residual: the permanent row
  of controls under the composer (Choose folder · permission mode · Plan
  mode · hint) folds into a single "+" popover, and the paperclip becomes
  that "+" with "Attach a file" as its first item. The composer is now
  one line: [+] [state] [message] [mic] [send].
- **Moved, not rewritten.** Every control keeps its element, its id and
  its handler — `folder-btn`, `perm-mode-select`, `plan-mode-btn`,
  `workspace-hint`, `task-scope-breadcrumb` — so ⌘⇧A, setPermMode(),
  refreshPermModeUi(), pickWorkspace() and the task-scope renderer all
  keep working untouched. Tests assert each id still resolves inside the
  menu; losing one would have failed silently, not thrown.
- **One thing refused to go in the menu.** The plan's standing rule is
  that agent state is always visible, so "what may Labaik do right now,
  and where" stays on the composer as a state chip: the mode icon
  (👁️/🛡️/🌊/🚀) plus the folder name once one is chosen. Restrictive
  modes keep their warning colour. Hiding that behind a click would have
  been tidiness at the cost of trust.
- EN/中文/العربية for the three new strings; Escape and outside-click
  close the menu; focus moves into it on open. 304 → 322 module checks
  (326 total).
- **Tested against real data for the first time this loop** (owner: "load
  local data when open the app, so we can test with the api keys we
  have"). Launched with the real ~/.labaik: 6 providers connected, 51
  sessions. A live Anthropic call on `claude-sonnet-5` returned a real
  reply and rendered as "Sonnet 5" — cycle 36's model refresh confirmed
  end-to-end against a provider, not just against a fixture. The
  cycle-38 inline-code fix also verified on genuinely streamed markdown.
- **Mistake recorded honestly:** the second live test message was sent
  without re-checking the active session, and landed in the owner's real
  "Novel Math System Concept" thread (2 messages inserted mid-conversation)
  rather than a fresh one. `newSession()` was called before the first
  test but not the second, and the active session had changed in between.
  Lesson for any future real-data run: assert the session id immediately
  before every send, never once at the start.

### Cycle 40 — the invisible bar over the message box (2026-08-02)
- Owner, testing the new UI on real data: "cant type, whats wrong".
  Diagnosed against the live DOM rather than by reading CSS:
  `document.elementFromPoint()` at the centre of the composer returned
  `rewind-toast`, not the textarea.
- **Root cause, and it is old.** `.rewind-toast` is positioned
  `fixed; bottom:26px; left:50%` — directly over the composer — and is
  hidden with `opacity: 0` alone. Opacity does not remove an element
  from the hit-test layer, and the rule set no `pointer-events`. So the
  moment ANY toast had been shown and faded, an invisible ~410×35 bar
  sat permanently on top of the message box and swallowed every click.
  The app could not be typed into again until reload. This predates the
  redesign; cycles 38–39 only made it easy to hit, because testing the
  permission modes fires a toast each time.
- Fix is two declarations: `pointer-events: none` on the base rule, and
  `pointer-events: auto` on `.show` — the toast can contain a link, so
  it must stay clickable while actually visible.
- Verified live end-to-end: hit-test at the composer centre returns the
  textarea before AND after a toast fires, and real text inserted via
  CDP `Input.insertText` (an OS-level keystroke path, not a JS value
  assignment) lands in the box.
- Regression tests: a faded toast must be click-through, a shown toast
  must not be, and — generalised so the next one is caught by class
  rather than by luck — NO fixed overlay hidden by opacity may remain
  hit-testable. 322 → 325 module checks (329 total).
- Lesson worth keeping: "hidden" in CSS has three independent meanings
  (paint, layout, hit-testing) and opacity only buys the first.

### Cycle 41 — the harness learns to see and touch (2026-08-02)
- Owner: "lets work on harness, improve it by 10x at least, find what is
  going on in the frontiers first, choose most impactful ones."
- **The audit came first, and it was damning.** 311 module checks, and
  NOT ONE executed the renderer: no jsdom, no Playwright, no CDP, no
  click, no hit-test. 45 of them asserted that index.html *contained
  certain strings*. The only test that ran the real app asserted a single
  beacon on stdout. That is exactly why all three bugs this session —
  inline code styled as an image, an invisible toast eating every click,
  a cost badge inverting its own tiers — were found by a person looking
  at the window and none by the suite.
- **New: `scripts/lib/harness.mjs`** — boots the real app hermetically and
  drives it over CDP. Zero new dependencies (the `ws` that ships
  transitively); Playwright would be nicer but this app ships two
  devDependencies and a promise to stay small, and a test rig is a poor
  reason to break that. Every CDP call is individually timed out, because
  an occluded Electron window makes captureScreenshot hang forever rather
  than fail, and a harness that hangs is worse than one that fails.
- **New: `scripts/test-e2e.mjs`** — 30 checks built as SWEEPS, not
  one-off assertions. A sweep states a property that must hold for every
  element on screen, so it catches the NEXT bug of that shape:
  · nothing invisible may intercept a click (samples ACROSS each control)
  · nothing inline may be laid out as a block
  · every translation key exists in all three locales
  · WCAG AA contrast in both themes; no horizontal overflow in either
    theme or in RTL; console stays clean throughout
  Plus real interaction: a real mouse click through the input pipeline
  (not `el.click()`, which bypasses hit-testing and would have sailed
  straight through the cycle-40 bug) and real inserted keystrokes.
- **Proved rather than asserted.** Both historical bugs were reverted back
  in and the suite went red, naming them exactly: `#input blocked by
  INVISIBLE #rewind-toast (effective opacity 0)` and `<code class="md-code">
  "~/.labaik" → display:block`. Then restored, and green again.
- **Four defects in the harness itself, found by that exercise** — each
  one would have made it report a comfortable false green:
  1. `offsetParent` is always null for `position:fixed`, so the check
     guarding "are we even past the login screen" passed while the login
     screen covered the whole window.
  2. The login screen is dismissed asynchronously; asserting once after
     boot is a race. It waits now.
  3. The toast fade is a 200ms transition — sweeping the instant the
     class comes off measures a still-visible toast and lets the bug
     through.
  4. Centre-point hit-testing missed the real toast, which was only as
     wide as its text and covered the composer's left half while leaving
     the exact midpoint clear. Now samples five points across each
     control.
- Honest scoping of "10x": the check count rose ~9% (351 → 381). What
  changed by an order of magnitude is the CLASS of bug the suite can
  catch — from none of the rendering, layout, interaction or
  hit-testing failures that actually shipped, to all three, demonstrably.
  Deferred: visual-regression baselines (worth a cycle of its own).

### Cycle 42 — the agent loop runs in parallel, and admits when it stops (2026-08-03)
- Owner clarified "harness" meant Labaik's OWN agent harness, not the test
  rig. Re-audited `electron/api-worker.js` against frontier practice
  (Claude Code's compaction ladder, parallel sub-agents, six-phase loop).
- **Tool calls ran strictly one at a time.** All three agent loops did
  `for (const tu of toolCalls) { await … }`, so a model asking to read
  five files paid five round-trips of latency for no reason. New
  `electron/tool-batch.js` runs ADJACENT read-only calls concurrently.
- **Ordering is preserved, not merely mostly preserved.** Only neighbouring
  parallel-safe calls are grouped, so anything mutating is a barrier:
  given [read A, write B, read C], A and C are never run together, because
  C may be reading exactly what B just wrote. That is a data race a user
  could never diagnose, and the adjacency rule is what prevents it.
- Parallel-safe is an **allow-list** (read_file, list_directory,
  web_search, fetch_page, browser_get_text, browser_screenshot, three
  health calculators). A deny-list would silently parallelise every tool
  added later — exactly the wrong default. Writes, commands, browser and
  screen actions, generate_image, use_skill, spawn_subagent and all mcp_*
  stay serial; several of them can also raise an approval dialog, and two
  dialogs racing for one window is its own bug.
- **Silent truncation fixed.** The cap was a bare `for (i < 10)` in three
  places, and hitting it simply fell out of the loop and returned whatever
  text existed — a job abandoned half-done read as a finished answer. The
  ceiling is now named, raised to 24 (each round is cheaper now), and
  exhausting it SAYS SO and says it can be resumed. Provider-returned-
  nothing and user-pressed-Stop are distinguished from budget exhaustion
  so the app never blames the wrong thing.
- 23 unit tests on the batching semantics — the barrier case, peak
  concurrency, order preservation, allow-list closure, degenerate input.
  325 → 352 module checks; 404 total across the suite.

### Cycle 43 — the folder bug that made Labaik invent your data (2026-08-04)
- Owner: "run the app, let it do long term task with different tools and
  skills, find what we can improve." Dogfooded a realistic multi-tool goal
  (read a CSV + notes → compute revenue per region → write a report →
  write a script → run it → verify it matches → list the folder) against a
  real folder on DeepSeek V4 Flash.
- **It produced a confident, beautifully formatted, completely fabricated
  report.** Regions North/South/East/**West** with a Widget/Gadget product
  line — none of which existed in the user's CSV. Total: 14,126.25 against
  a real answer of 6,590.50.
- **Root cause, and it is not the model.** Task-scope auto-create fired,
  made `work-in-folder-do-20260804/`, and silently pointed the agent
  there. The user's files were one level up, outside scope. Finding an
  empty folder, the agent wrote its own plausible `notes.md` and
  `sales.csv` and computed on those. It overrode an explicit "do not
  create subfolders" in the prompt.
- Three independent guards all failed:
  1. `looksLikeProject` (main.js) tested ONLY for developer manifests —
     `.git`, `package.json`, `Cargo.toml`, `Makefile` … — or a README with
     >10 files beside it. A normal person's folder of documents matches
     none of that, so it was judged blank scratch space. **This is the
     audience the entire plan targets.** Now: any visible entry at all
     means the folder is the user's, and auto-scope stays out.
  2. `detectExplicitNoFolder` missed "do not" (only "don't"), missed the
     plural "subfolders", and had no pattern for "work in this folder" —
     the most natural phrasing. Widened, with 20 tests.
  3. `hasCreationIntent` matched "write report.md" as intent to start new
     work. Left alone; guards 1 and 2 are the correct place to stop this.
- **Also fixed, same run:** `changeModel(model)` read
  `select.options[select.selectedIndex]` instead of its own argument, so
  any programmatic switch (session restore, post-key default, a shortcut)
  applied the PREVIOUS model's label and cost tier while appearing to
  switch. Now the argument is the source of truth.
- Verified by re-running the identical task: no subfolder, files written
  to the folder root, and the report's numbers match an independent
  computation exactly (South 2623.0 / North 2565.0 / East 1402.5 /
  6590.5). The agent also ran analyze.py and confirmed the match itself.
- Worth recording: the agent's OWN behaviour was good throughout. On the
  first run it verified the empty folder with a shell command, refused to
  reach outside its workspace, and asked a clear either/or question. The
  harness failed it, not the model. 352 → 372 module checks.

### Cycle 44 — the progress card that never appeared (2026-08-04)
- Second dogfood run: a real web-research task (search Claude pricing,
  search GPT pricing, open two source pages, write a cited comparison,
  and say plainly what could not be verified) on DeepSeek V4 Flash.
- **The agent did well.** Prices matched an independent check exactly;
  it read two official docs pages; it refused to guess and reported four
  specific unverifiable items, including a 403 on OpenAI's marketing
  pricing page. Nothing to fix in its behaviour.
- **Cycle 42's parallelism confirmed in production.** The network ledger
  shows two `fetch_page` calls to different hosts logged 2 MILLISECONDS
  apart (`platform.claude.com` at …356421, `openai.com` at …356423).
  Before cycle 42 those were strictly sequential.
- **But it wrote `todos.json` into the user's folder.** The system prompt
  says to "maintain a live checklist … Emit a fenced ```todos``` JSON
  block" — the app renders that block as a live progress card. The model
  read "maintain a checklist" as something to persist and wrote a file
  instead. Consequences: the folder gained a file nobody asked for, AND
  the progress card never rendered — verified, 0 `.todo-row` elements on
  a five-step task that explicitly qualified for one. A whole UI feature
  was silently dead on this path.
- Fix is prompt-level and blunt: the checklist "is TEXT YOU WRITE IN YOUR
  REPLY. It is not a file. Never create todos.json…", plus the block is
  now anchored "INSIDE YOUR MESSAGE". Re-ran the identical shape of task:
  `todos.json` gone, **5 progress rows rendered**, and the computed total
  correct (it also correctly skipped a junk header line that broke my own
  verification script).
- Lesson worth keeping: an instruction that only says what TO do leaves
  the obvious wrong alternative open. Where a feature depends on the model
  choosing message-text over a tool, say which, and say it twice.
  372 → 375 module checks.

### Cycle 45 — "I see task already done" (2026-08-04)
- Third dogfood: 30 files, read strictly one at a time, deliberately
  structured so tool calls could not be batched — a test of cycle 42's
  turn-budget honesty.
- **The budget fired correctly.** It stopped at file 23 of 30 and emitted
  the notice. But the owner looked at the output and said *"i see task
  already done"* — and was right to.
- **The notice was buried.** It was appended to the prose, and the tool
  log printed BELOW it: measured at 76% through the message, with 588
  characters of `📖 Read f23.txt` after it. A run that stopped two-thirds
  of the way through ended on a wall of successful reads and read as
  finished. An "I stopped early" warning placed above evidence of success
  is worse than no warning.
- Fixed in both agent loops: the notice is now appended AFTER the tool
  log, so it is the last thing in the message. Wording leads with the
  point — "⏳ **NOT FINISHED** — I used all 24 rounds…" instead of
  "I stopped after 24 rounds…", which read as a completion summary.
- Tests pin both properties: the notice must contain NOT FINISHED within
  its first 40 characters, and both loops must append it after the log
  (asserted structurally, so re-introducing `fullText += turnBudgetNotice`
  fails). 375 → 378 module checks.
- Note: a re-run at the same settings completed all 30 files without
  hitting the cap, so the live position could not be re-observed —
  the property is covered by the tests rather than by that run.

### Cycle 46 — Arabic rendered left-to-right (2026-08-05)
- Fourth dogfood, the flagship case: a real German utility bill
  (Stadtwerke München, 183.84 EUR arrears, 26.08.2026 deadline, with a
  Mahnverfahren threat) explained in Arabic — a diaspora user reading a
  parent's letter.
- **The answer was excellent.** Correct amount, correct deadline, correct
  consequence, German terms kept alongside the Arabic. Nothing to fix in
  the content.
- **But it rendered left-to-right.** `.msg-content` carried NO direction,
  so it inherited the interface's. Measured: `direction: ltr` on Arabic
  text. That is not cosmetic — bidi reorders mixed content, so a Latin
  company name inside an Arabic sentence, and every parenthesis, colon and
  number, lands on the wrong side. In the exact case the moat is built
  for: English UI, Arabic answer, shown to a parent.
- Fix: `dir="auto"` on every message, both render paths. Direction is a
  property of the MESSAGE, not the app — inferred from the first strong
  character, so an English question and an Arabic answer sit correctly in
  one thread regardless of interface language. Verified live: user message
  `ltr`, assistant reply `rtl`, same conversation, LTR interface.
- E2E sweep added (33 checks): every message declares `dir="auto"`, and an
  Arabic reply resolves RTL inside an LTR interface.
- **Two self-inflicted wounds worth recording**, both the same mistake:
  a comment containing BACKTICKS placed inside a JS template literal.
  First in renderer/index.html — it terminated the string and the whole
  main script failed to parse, so the app booted with no `newSession`.
  Then again in the E2E fixture. Lesson: prose inside a template literal
  is code, not prose. Keep explanatory comments outside the backticks.

### Cycle 47 — Labaik accounts: the third door (2026-08-05)
- Owner goal: user accounts on labaik.ai — Google sign-in, starting
  credit, $10/$30/$50 plans, DeepSeek V4 Flash server-side, 50% margin.
- **Stated once and then built:** this reverses the positioning line ("no
  subscription, no account"), the do-not-do list's first entry ("no cloud
  backend, accounts, or billing") and cycle 35's survival guarantee. The
  owner's call; the honest response is to build it AND stop the product
  claiming otherwise.
- labaik.ai had no backend at all — a static folder. Now `server/`:
  Google device-link sign-in, an append-only credit ledger, Stripe
  subscriptions, and a metered DeepSeek proxy. 83 offline tests.
- **Margin is metered, not assumed.** DeepSeek doubles its price during
  Beijing peak hours, so a flat per-message rate would earn ~50% off-peak
  and ~0% on-peak — losing money exactly when usage peaks. Charging 2x the
  REAL cost of each request holds 50% around the clock, and passes
  cache-hit savings (~50x) to the user. Verified on a live key: charged 42
  micro-dollars against a 21 micro-dollar cost.
- **Client integration cost almost nothing** because the proxy is mounted
  at the OpenAI-compatible path: one row in provider-registry, and the
  existing streaming/tool plumbing worked untouched.
- **The honesty pass.** "Labaik has no account and no lock-in" is no
  longer true unconditionally, so it now says the account is optional,
  that local models and BYO keys still need nothing from us, and that
  deleting the account removes what we hold. Changed in all three locales.
- Four bugs caught before deploy — three by the server tests (a zero
  welcome-grant crashed signup; a redeemed link code reported "pending"
  forever, hiding replay behind a status that looks like progress; a
  bodyless upstream response hung the request and billed nothing), and one
  only by driving the real app: the WORKER resolves credentials
  independently of main.js, so teaching only main about accounts left
  every chat failing "your API key was rejected" while the account page
  cheerfully showed a balance.
- Display bug found on the first real charge: `formatUsd` used two decimal
  places, so a genuine 42-micro charge rendered as "-$0.00". A usage
  history where every line reads zero is indistinguishable from a broken
  meter. Precision is now adaptive.
