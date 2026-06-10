# Agent Landscape Research - April 27, 2026

Research snapshot for Labaik v0.7.65 against Claude Code, OpenAI Codex, OpenCode, OpenClaw, Hermes Agent, and adjacent agent tools.

This is a product and architecture brief, not a benchmark paper. Public claims were checked against primary docs where possible. Labaik capabilities were checked against the local repo at `/Users/ahmed/Desktop/build/claude/alaude-desktop`.

## Executive Summary

The agent market has converged on a few primitives:

1. **Skills are becoming the portable extension unit.** Claude Code and Codex both support folder-based `SKILL.md` skills. Claude describes skills as selectively loaded instructions whose body only enters context when used; Codex follows the agentskills.io folder standard with optional scripts, references, and assets. OpenClaw also uses AgentSkills-compatible folders. Labaik's current "Skills" are cron-style scheduled prompts, so the name now conflicts with the broader ecosystem.
2. **Subagents are now expected in serious coding agents.** Claude Code, Codex, OpenCode, and Hermes all expose isolated workers with their own prompts, tool access, and context. Labaik's Crew mode is useful but different: it runs multiple model lanes on the same user prompt rather than letting the main agent delegate scoped work.
3. **Sandboxing and permissions are becoming product differentiators.** Claude Code documents OS-level shell sandboxing with filesystem and network controls. Codex has a full docs area for sandboxing, approvals, worktrees, rules, hooks, and security. Labaik has workspace path guards and permission classification, but not OS-level sandbox enforcement.
4. **Worktrees and background environments are the new parallelism layer.** Codex's app manages per-thread worktrees and can hand threads between local and background worktree contexts. Claude Code supports worktree isolation for sessions/subagents. Labaik does not yet have worktree-per-session.
5. **MCP moved from "nice integration" to platform substrate.** Claude Code, Codex, OpenCode, Hermes, and OpenClaw all treat MCP as a first-class extension surface. Labaik has a lean stdio MCP client, but lacks HTTP/SSE transport, OAuth, resources/prompts, and MCP server mode.
6. **Agents are escaping the terminal.** Codex is available through app, CLI, IDE, web, GitHub, and Slack-style workflows. Claude Code has CLI, desktop/web, hooks, scheduled prompts, and integrations. OpenClaw and Hermes focus on always-available agents reachable from messaging platforms. Labaik's desktop-first consumer UI remains differentiated, but cloud and channel reach are becoming table stakes.

## Labaik Baseline

Checked locally:

- `package.json` version: `0.7.65`.
- Electron desktop app for macOS with planned Windows/Linux build targets.
- Providers: Anthropic, OpenAI, Google, xAI, Kimi global, Moonshot/Kimi CN, DashScope/Qwen, Zhipu/GLM, MiniMax, Hunyuan, DeepSeek, Ollama.
- Tool stack in `electron/api-worker.js`: workspace file tools, command/server tools, browser tools, screen-control tools, health tools, MCP tools.
- MCP client in `electron/mcp.js`: stdio JSON-RPC tools only, configured under `~/.alaude/mcp-servers.json`.
- Scheduled "Cron Skills" in `electron/skills.js`: prompt plus cron expression, run in-process while the app is awake.
- Permission classification in `electron/permissions.js`: mode/rule based gating, dangerous command detection, workspace-aware checks.
- Browser agent in `electron/browser-agent.js`: persistent Chromium BrowserWindow driven by tool calls.
- Streaming is present in worker code for OpenAI-compatible, Ollama, and Anthropic paths. Older notes saying "no token streaming" are stale.
- Unique surfaces: Spaces, Crew mode, Screen Vision/screen control, health calculators/triage/drug/lab tooling, local memory/profile, rich blocks, local-only OODA event loop.

Confirmed gaps:

- No `AGENTS.md` ingestion.
- No Anthropic/Codex/OpenClaw-style folder skills.
- No true subagent abstraction with isolated context and per-agent tools.
- No plan/read-only mode.
- No OS-level sandboxing for shell subprocesses.
- No worktree-per-session.
- MCP is stdio/tools-only; no HTTP, OAuth, resources/prompts, sampling policy, or server mode.
- No hooks lifecycle.
- No cloud/background delegation or PR bot.
- No IDE extension or terminal/TUI surface.
- No messaging-channel gateway.

## Tool Notes

### Claude Code

Claude Code is the most mature proprietary coding-agent reference point. The important features for Labaik are not "Anthropic model access"; they are the product primitives around the model:

- Skills: `SKILL.md` directories, optional supporting files, automatic and explicit invocation, tool pre-approval, subagent execution, hooks in skill frontmatter.
- Subagents: specialized assistants with separate context windows, custom prompts, tool access, and independent permissions.
- Hooks: broad lifecycle event system, including tool events, subagent events, task events, compaction events, and permission events.
- Sandboxing: OS-level Bash sandboxing with filesystem and network restrictions. macOS uses Seatbelt; Linux/WSL2 use bubblewrap.
- Worktrees: sessions/subagents can run in isolated git worktrees.

Implication for Labaik: Claude Code sets the bar for "agent as programmable development environment." Labaik can compete by making these primitives approachable in a desktop UI, but it needs at least AGENTS.md, skills, plan mode, subagents, and sandboxing to feel current.

### OpenAI Codex

Codex has expanded into a broad agent platform: app, CLI, IDE extension, web/cloud, GitHub/automation, MCP server mode, hooks, skills, subagents, worktrees, and security docs.

Relevant confirmed docs areas:

- Codex docs navigation lists app, IDE, CLI, web, GitHub/Slack/Linear integrations, rules, hooks, AGENTS.md, MCP, plugins, skills, subagents, app server, MCP server, GitHub Action, and worktrees.
- Codex changelog says agent skills are available in CLI and IDE extensions and follow a folder-based `SKILL.md` standard with optional scripts, references, and assets.
- Worktree docs describe Codex-managed worktrees in `$CODEX_HOME/worktrees`, one thread per lightweight disposable worktree by default, plus permanent worktrees.
- OpenAI's public Codex launch post described cloud tasks running independently in isolated environments; later changelog entries added controlled internet access.

Implication for Labaik: Codex is defining the "agent everywhere" bundle: app + CLI + IDE + cloud + automations + docs-backed extension model. Labaik should either adopt the same interop primitives or deliberately position as the local, multi-provider, consumer-friendly counterweight.

### OpenCode

OpenCode is the open-source terminal/TUI and desktop competitor with a strong developer identity.

Confirmed from docs:

- Supports terminal, IDE, web/docs surfaces, config, providers, permissions, LSP servers, MCP servers, agent skills, custom tools, plugins.
- Agents are first-class: primary agents and subagents.
- Built-ins include Build and Plan primary agents, plus General and Explore subagents.
- Plan is intentionally restricted so users can analyze and plan without actual code changes.
- Subagents can be invoked automatically or by `@mention`, and child sessions are navigable.
- The OpenCode homepage emphasizes LSP, multi-session parallel agents, share links, GitHub Copilot login, ChatGPT login, 75+ providers, local models, desktop app, and IDE extension.

Implication for Labaik: OpenCode is a strong model for a multi-provider developer tool. Labaik has a warmer desktop UX and richer consumer/domain surfaces, but OpenCode is ahead on developer workflow primitives: LSP diagnostics, plan/build modes, agent configuration, session sharing, and terminal-native ergonomics.

### OpenClaw

OpenClaw is closer to an always-on personal assistant gateway than a pure coding agent.

Confirmed from docs:

- Self-hosted gateway across Discord, Google Chat, iMessage, Matrix, Teams, Signal, Slack, Telegram, WhatsApp, Zalo, WebChat, and mobile nodes.
- One Gateway process routes sessions, channels, and agents.
- Multi-agent routing, per-agent/per-sender/workspace isolation, media support, web control UI, mobile nodes.
- `openclaw agent` can target a session, destination, or configured agent, with channel delivery options.
- Skills are AgentSkills-compatible folders loaded from bundled, user, project, and workspace locations.
- Docs expose templates for `AGENTS.md`, `SOUL.md`, `TOOLS.md`, and related prompt files.

Implication for Labaik: OpenClaw owns the "message your agent from anywhere" story. Labaik can borrow the gateway idea later, but the immediate opportunity is to adopt interoperable prompt/skill files so Labaik can participate in the same personal-agent ecosystem.

### Hermes Agent

Hermes is a persistent autonomous agent with a learning loop rather than a desktop coding assistant.

Confirmed from docs:

- Described as a self-improving agent with memory nudges, autonomous skill creation, skill improvement, cross-session recall, and user modeling.
- Runs on local, Docker, SSH, Daytona, Singularity, and Modal-style backends.
- Lives across messaging platforms including Telegram, Discord, Slack, WhatsApp, Signal, Matrix, email/SMS-style channels, and others.
- Supports scheduled automations, subagents, browser/web/vision/image/TTS tools, MCP, and skills.
- MCP config supports stdio and HTTP servers, tool filtering, resources, prompts, OAuth with PKCE, and sampling policy.
- CLI docs include `hermes mcp serve`, meaning Hermes can also expose itself as an MCP server.

Implication for Labaik: Hermes points toward persistent memory, background autonomy, and agent self-improvement. Labaik already has memory/profile and OODA concepts; the next step is to make these visible as reliable product loops, not hidden implementation details.

## Feature Matrix

Legend: yes = shipped; partial = present but narrower; no = not found.

| Feature | Labaik | Claude Code | Codex | OpenCode | OpenClaw | Hermes |
|---|---:|---:|---:|---:|---:|---:|
| Desktop app | yes | yes | yes | partial | yes | no |
| CLI/TUI | no | yes | yes | yes | yes | yes |
| IDE extension | no | yes | yes | yes | no | no |
| Web/cloud task runner | no | partial | yes | partial | partial | yes |
| Messaging-channel gateway | no | partial | partial | no | yes | yes |
| Multi-provider models | yes | no | no | yes | yes | yes |
| Local Ollama/local models | yes | no | no | yes | yes | yes |
| Browser/computer use | yes | partial | yes | partial | partial | yes |
| True subagents | no | yes | yes | yes | partial | yes |
| Multi-model parallel answers | yes | partial | partial | no | no | no |
| Plan/read-only mode | no | yes | yes | yes | no | partial |
| Worktree-per-session | no | yes | yes | no | partial | partial |
| OS-level sandboxing | no | yes | yes | partial | partial | partial |
| Permissions/rules | partial | yes | yes | yes | partial | partial |
| Hooks lifecycle | no | yes | yes | no | yes | yes |
| MCP stdio tools | yes | yes | yes | yes | yes | yes |
| MCP HTTP/OAuth/resources/prompts | no | yes | yes | partial | partial | yes |
| Acts as MCP server | no | yes | yes | no | partial | yes |
| Folder skills (`SKILL.md`) | no | yes | yes | yes | yes | yes |
| Scheduled automations | yes | yes | yes | no | yes | yes |
| Persistent memory/profile | yes | partial | partial | partial | partial | yes |
| Domain spaces/tool gating | yes | partial | partial | no | partial | partial |
| Rich artifacts/blocks | yes | partial | yes | partial | partial | partial |

## Roadmap Recommendations

### Tier 1: Fast Interop Wins

1. **Read `AGENTS.md`.** Search from workspace root upward, apply precedence, inject concise instructions into the system prompt. This is the cheapest way to make Labaik feel compatible with the coding-agent ecosystem.
2. **Add folder skills beside Cron Skills.** Keep scheduled prompts but rename them to "Routines" or "Automations" in the UI. Implement `SKILL.md` with frontmatter, description-only discovery, lazy loading, and project/user locations.
3. **Add Plan mode.** A read-only mode that disables write, command, browser-fill/click, and screen-control actions unless explicitly escalated. This is high UX value and relatively contained.
4. **Upgrade MCP config.** Move from `~/.alaude/mcp-servers.json` toward `~/.labaik/mcp-servers.json` with migration, add HTTP server URLs, headers, timeout, tool include/exclude filters, resources/prompts toggles, and OAuth placeholder fields.

### Tier 2: Agent Architecture

5. **Implement subagents.** Let the main Labaik session dispatch scoped tasks into isolated child contexts. Reuse Crew UI language, but distinguish "compare models" from "delegate work." Start with two built-ins: Explore (read-only) and Worker (write-capable).
6. **Add hooks.** Start with four events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionEnd`. Support command hooks first; later add prompt/agent hooks.
7. **Worktree sessions.** Add optional "Run in worktree" for workspace chats. This pairs naturally with subagents and makes parallel coding safer.
8. **Improve permission profiles.** Current classifier is useful, but productize it as Observe / Ask / Auto / Full Access profiles with visible per-workspace rules.

### Tier 3: Strategic Bets

9. **OS-level command sandbox.** On macOS, investigate Seatbelt; on Linux, bubblewrap. If full sandboxing is too large, start with command execution inside a per-session temp workspace plus explicit mount/allow rules.
10. **MCP server mode.** Expose Labaik memory, Spaces, browser, screen vision, and provider routing as MCP tools for other agents. This turns Labaik into infrastructure, not only an app.
11. **Channel gateway.** Start with Telegram or Slack as a single remote-control channel for scheduled automations and long-running tasks. Avoid trying to match OpenClaw's channel breadth at first.
12. **Cloud/local hybrid delegation.** If Labaik stays local-first, make that a strength: local background workers, optional user-provided remote SSH runners, and no hosted backend by default.

## Positioning

Labaik should not try to become a Claude Code clone. Its strongest lane is:

> A local-first, multi-provider AI desktop that brings agent tooling to normal people and power users, not only terminal-native developers.

Defend these differentiators:

- **Provider breadth and local models.** Claude Code and Codex are single-provider experiences. Labaik's "every AI, one desktop" story is still strong.
- **Spaces.** Most competitors have skills or agents; Labaik has full domain environments with tool gating and quick actions.
- **Health Space.** This is genuinely differentiated, but it needs careful clinical disclaimers and guardrails.
- **Crew mode.** Keep it as "compare and debate models." Add subagents separately as "delegate work."
- **Screen Vision and Browser Agent.** Labaik is already strong for desktop/browser operation.
- **Local privacy.** No backend and no telemetry is a clean counter-position to cloud agents.

## Biggest Risks

1. **Interop drift.** Without `AGENTS.md` and folder skills, Labaik will feel outside the agent ecosystem even if its core chat is strong.
2. **Safety gap.** Workspace path guards are not enough once agents run arbitrary commands, browser actions, and screen control.
3. **Name collision.** "Skills" now means `SKILL.md` agent capabilities across several products. Labaik's cron Skills should be renamed before the term hardens further.
4. **Developer workflow gap.** Plan mode, subagents, worktrees, hooks, and LSP diagnostics are becoming expected in coding agents.
5. **Distribution gap.** Competitors are in CLI, IDE, cloud, GitHub, Slack, and mobile channels. Labaik's desktop focus is a strength only if the desktop experience is meaningfully better.

## Sources

- Labaik local source: `README.md`, `package.json`, `electron/api-worker.js`, `electron/mcp.js`, `electron/skills.js`, `electron/permissions.js`, `electron/browser-agent.js`.
- Claude Code docs: https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/sandboxing, https://code.claude.com/docs/en/changelog
- OpenAI Codex docs: https://developers.openai.com/, https://developers.openai.com/codex/changelog, https://developers.openai.com/codex/app/worktrees, https://github.com/openai/codex/blob/main/docs/agents_md.md, https://github.com/openai/codex/blob/main/docs/sandbox.md
- OpenCode docs: https://dev.opencode.ai/, https://opencode.ai/docs/agents/
- OpenClaw docs: https://docs.openclaw.ai/, https://docs.openclaw.ai/cli/agent, https://docs.openclaw.ai/tools/skills, https://github.com/openclaw/openclaw
- Hermes Agent docs: https://hermes-agent.nousresearch.com/docs/, https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference, https://hermes-agent.nousresearch.com/docs/reference/cli-commands
- AGENTS.md standard: https://agents.md/
