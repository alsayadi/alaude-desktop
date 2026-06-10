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
