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
2. ~~Folder skills onboarding is dev-flavored — one-click starter skills~~ → fixed cycle 2
3. ~~`/explain` snippet assumes a dev~~ → fixed cycle 2 (new installs only; body
   edits don't propagate through the seen-merge, by design)
4. ~~Routines modal templates: everyday-life additions~~ → fixed cycle 3
   (meal plan still a candidate)
5. ~~Spaces~~ — audit was WRONG: built-in Spaces are already fully general
   (General, Health, Finance, Real Estate, Legal, Education, Marketing — there
   is no coding space at all). Nothing to do.
6. ~~Attachment ergonomics~~ → mostly already solid (picker, PDFs with page
   counts, multimodal images); the real gap — drop target was only the message
   list — fixed cycle 4 (window-wide drop).
7. **Empty-workspace nudges**: composer placeholder and tips reference code tasks
   in places — sweep for dev-jargon strings shown when no workspace is open.
   (Onboarding done cycle 3; remaining: tips/hints/shortcut surfaces.)

## Cycle log

### Cycle 1 — slash snippets rebalanced (2026-06-10)
- Added 5 general defaults: /email, /brainstorm, /rewrite, /plan, /decide.
- Added one-time merge of NEW defaults into existing installs via
  `alaude:snippets:seen:v1` — previously, default updates never reached
  existing users; deliberate deletions stay deleted.

### Cycle 2 — starter skills pack + /explain de-jargoned (2026-06-10)
- 3 bundled general skills (meeting-notes, trip-planner, weekly-review) in
  folder-skills.js; installable via command palette → "Install starter
  skills". Idempotent — user-edited starters never overwritten.
- /explain rewritten for any topic, not "experienced developer" framing.

### Cycle 3 — onboarding de-jargoned + life routines (2026-06-10)
- Memory onboarding no longer assumes a developer: "Main stack / languages /
  frameworks?" → "What do you work on or care about?", coding-preference
  placeholders → answer-style preferences. Updated in EN/中文/العربية (dicts +
  inline HTML fallbacks).
- 3 everyday-life routine templates: 💊 medication reminder, 🗣️ language
  practice, 💳 weekly bills & renewals check.
- Next candidates: non-coding Spaces (Writing, Learning/Tutor, Travel);
  attachment ergonomics (PDF/doc without a workspace); meal-plan routine.

### Cycle 4 — window-wide drag & drop (2026-06-10)
- Audit correction: Spaces were already general (7 built-ins, none coding);
  attachments already handle PDFs/images/docs well.
- Real gap found and fixed: files could only be dropped on the message list.
  Now the whole window accepts drops (composer, sidebar, anywhere) with a
  drag-depth counter to stop overlay flicker.

### Cycle 5 — final sweep + meal plan (2026-06-10) · LOOP CONCLUDED
- Jargon sweep came back clean: quick-start templates are balanced
  (build/office/ideate), smart-paste "stack trace" hints only fire on actual
  stack-trace pastes (contextual, not bias), composer placeholder is neutral.
- Added 🥗 weekly meal plan routine template (Sunday 5pm).
- "Learning" space skipped — the Education space already covers tutor use.
- **Backlog exhausted.** Five cycles total; branch ready to ship.
