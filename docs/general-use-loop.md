# General-Use Loop — make Labaik useful beyond coding

Working log for the `/loop make labaik work for more general use not only for coding`
sessions. One cycle = one audit-pick-implement-test-commit pass on branch
`feature/general-use`.

## Audit (cycle 1, 2026-06-10)

Where Labaik is already general:
- Welcome screen: Build / Office / Ideate chips + balanced quick-starts (v0.7.68)
- Routine templates: news, standup, inbox triage, writing prompt — mostly general
- Health space: lab analysis, drug interactions, calculators, PHQ-9/GAD-7
- i18n: EN/中文/العربية with RTL
- System prompt: lean general opener; coding guidance only added when a workspace is open

Coding bias found (backlog, highest leverage first):
1. ~~Slash snippets: 5 of 8 defaults are code tasks~~ → fixed cycle 1
2. **Folder skills onboarding is dev-flavored** — README.md speaks in file/frontmatter
   terms; the empty slash menu / palette could offer one-click starter skills for
   general users (meeting notes, trip planner, weekly review).
3. **`/explain` snippet** says "like I'm an experienced developer" — tone assumes a dev.
4. **Routines modal templates** could add: medication reminder, language practice,
   meal plan, bill/renewal reminders.
5. **Spaces**: only Health is a rich non-coding space — candidates: Writing,
   Learning/Tutor, Travel, Finance-literacy (no advice).
6. **Attachment ergonomics**: @ mentions need an open workspace; general users
   think "attach a file" — check drag-drop/file-picker parity for PDFs/docs.
7. **Empty-workspace nudges**: composer placeholder and tips reference code tasks
   in places — sweep for dev-jargon strings shown when no workspace is open.

## Cycle log

### Cycle 1 — slash snippets rebalanced (2026-06-10)
- Added 5 general defaults: /email, /brainstorm, /rewrite, /plan, /decide.
- Added one-time merge of NEW defaults into existing installs via
  `alaude:snippets:seen:v1` — previously, default updates never reached
  existing users; deliberate deletions stay deleted.
