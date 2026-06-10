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
