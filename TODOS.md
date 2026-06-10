# TODOS

## Skills

### Skills management UI

**What:** In-app surface to list, create, and edit folder skills (like the Routines modal does for routines).

**Why:** Skills currently require dropping folders into `~/.labaik/skills/` by hand; discoverability is limited to the slash menu and command palette.

**Context:** `electron/folder-skills.js` handles discovery; `use_skill` makes them model-invocable (v0.7.72). A modal mirroring the Routines modal (list + create form writing SKILL.md) closes the loop. The empty-state hint should show the skills root path from `folderSkillsList().root`.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Agents

### Timeout for worker→main bridge requests

**What:** Add a timeout to `_bridge()` in `electron/api-worker.js` (mcp-list, mcp-call, browser-tool, screen-tool) so the worker can't wait forever if main never answers.

**Why:** Found while building the worker-loop fixture: a chat hangs indefinitely if the `mcp-list` response never arrives. `requestApproval` already has a 10-minute cap; the other bridges have none.

**Context:** `_bridge(map, type, extra)` registers a resolver and waits. Mirror the approval pattern: `setTimeout` + `unref()`, resolve with an error object after ~30s so the turn degrades (no MCP tools) instead of hanging.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Worktree isolation for subagents

**What:** Run subagents (and optionally sessions) in isolated git worktrees.

**Why:** Parallel subagents mutating the same workspace can conflict; worktree-per-agent is the ecosystem pattern (Claude Code, Codex) per docs/research/agent-landscape-2026.md.

**Context:** `runSubAgent()` in `electron/api-worker.js` currently shares the parent's `workspacePath`. A worktree wrapper would create/cleanup `git worktree` dirs and pass the isolated path to the nested loop.

**Effort:** L
**Priority:** P3
**Depends on:** None

## MCP

### HTTP/SSE transport + OAuth

**What:** Extend `electron/mcp.js` beyond stdio: streamable HTTP transport, OAuth flows, resources/prompts.

**Why:** Confirmed gap vs Claude Code/Codex/OpenCode (agent-landscape research); remote MCP servers are unusable today.

**Effort:** L
**Priority:** P3
**Depends on:** None

## Permissions

### OS-level sandboxing for shell tools

**What:** Sandbox `run_command` / `start_dev_server` with Seatbelt (macOS) / bubblewrap (Linux) filesystem+network profiles.

**Why:** Current enforcement is string-level scope checking (`checkCommandScope`) — bypassable; OS-level enforcement is becoming a product differentiator.

**Effort:** XL
**Priority:** P3
**Depends on:** None

## Future Console

### Decide: productize or cut the Future Console

**What:** The experimental cockpit window (`renderer/future.html`, tray + ⌘⇧F) ships dark — either grow it into the agent dashboard or remove the entry points.

**Why:** Shipping an unfinished surface with menu/tray entries invites confusion.

**Effort:** M
**Priority:** P3
**Depends on:** None

## Completed

(Items completed before TODOS.md existed are tracked in CHANGELOG.md.)
