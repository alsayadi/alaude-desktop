# Changelog

All notable changes to Labaik are documented here.
Versions follow `MAJOR.MINOR.PATCH` (package.json is the source of truth).

## [0.7.72] - 2026-06-10

### Added
- **Subagents** — `spawn_subagent` tool lets the model delegate focused,
  self-contained tasks to a nested agent with its own context and tool
  budget (depth-capped, no recursion). Sub-agent tool activity shows as
  indented chips in the UI.
- **Folder skills, model-invocable** — skills under `~/.labaik/skills/<slug>/SKILL.md`
  are listed (name + description only) in the system prompt; the body loads
  on demand via the new `use_skill` tool. Skills also appear in the composer
  slash menu as `/<slug>` triggers.
- **Approval flow (Careful/Flow modes)** — side-effecting tools
  (`write_file`, `run_command`, `start_dev_server`, `open_in_browser`)
  round-trip a permission dialog with Allow once / Always allow / Deny;
  "always" persists a per-workspace rule.
- **@ file mentions** — type `@` in the composer to fuzzy-search workspace
  files; mentioned file contents auto-attach to the message (10 files /
  24KB caps, workspace-escape guarded).
- **Git context injection** — branch, capped status, and recent commits are
  injected into the system prompt for git workspaces.
- **Plan mode** — produce a reviewable plan with tools disabled until approved.
- **AGENTS.md / CLAUDE.md auto-injection** from the workspace root.
- **Image generation** as a chat tool (gpt-image-1) + GPT-5.5 model family.
- **i18n** — English / 中文 / العربية UI with full RTL support.
- **Future Console** — experimental agent-cockpit window (tray + ⌘⇧F).
- End-to-end agent-loop test fixture (`npm run test:worker`) covering
  subagents, the approval bridge, `use_skill`, @-mentions, and git context
  against a mock provider — no API keys needed.

### Changed
- **Cron "Skills" renamed to "Routines"** end-to-end (module, storage,
  IPC, UI, i18n). `skills.json` migrates to `routines.json` automatically;
  the "Skills" name now refers to folder skills.
- All state migrated from `~/.alaude` to `~/.labaik`; `LABAIK_HOME` env
  override keeps test runs hermetic.
- Browser tools are only offered to the model when the user's message
  signals browser intent; same gating for image generation.
- Reasoning models get a 5-minute idle cap (was 90s) so long thinking
  isn't killed mid-analysis; other cloud models 3 minutes.
- Response rendering decluttered across seven OODA passes (metadata,
  chips, code-block chrome, tables, narration trim).
- Welcome screen redesigned around Labaik-specific starter templates.

### Fixed
- Approval dialogs no longer disable the chat idle-timeout for the rest
  of the turn after the first approval (chat-id lookup bug).
- Generated images respect `LABAIK_HOME` instead of always writing to
  `~/.labaik/images`.
- EPIPE on stdout/stderr no longer crashes the app when the parent shell
  exits.
- Streaming: post-stream verification (length-cap warning, empty-stream
  detection) and malformed tool-args no longer crash the turn.
- Numerous RTL/i18n fixes (topbar, modals, sidebar drag, bidi badges).
