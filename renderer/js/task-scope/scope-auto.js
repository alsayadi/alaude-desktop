// ScopeAutoCreator — the "decide + act" layer for automatic scoping.
//
// v0.7.37 rewrite: context-aware, not just project-marker-based.
//
// Called from the send flow on every user message. Priority-ordered decisions:
//
//   1. No workspace                        → skipped-no-workspace
//   2. Session has explicit decision       → skipped-explicit
//   3. User explicitly rejected subfolder  → lock off, skipped-user-rejected
//   4. User explicitly NAMED a subfolder   → create with that name (manual)
//   5. Workspace is an existing project    → skipped-project (one-time toast)
//   6. Prompt has no creation intent       → skipped-no-intent
//   7. Prompt is trivial filler            → skipped-trivial
//   8. All checks pass                     → create with auto-generated slug
//
// The big change vs v0.7.32: we no longer auto-create just because a
// workspace LOOKS empty. The prompt itself has to express creation intent
// ("build/create/make/generate/design") OR the user has to explicitly
// name a target folder. This matches user's ask: "app decides based on
// context, unless user asks to make that."

export class ScopeAutoCreator {
  constructor({ store, detector, getWorkspace, api = globalThis.alaude, onChange, toast }) {
    this.store = store
    this.detector = detector
    this.getWorkspace = getWorkspace
    this.api = api
    this.onChange = onChange || (() => {})
    this.toast = toast || (() => {})
    this._seenProjects = new Set()
  }

  async maybeAutoCreate(promptText) {
    const ws = this.getWorkspace()
    if (!ws) return { acted: 'skipped-no-workspace' }

    // 1. Explicit rejection THIS message → lock off for this turn, respect it.
    if (this.detector.detectExplicitNoFolder(promptText)) {
      this.store.clearScope()
      this.toast('📁 Got it — no subfolder, writing to workspace root.', false)
      return { acted: 'skipped-user-rejected' }
    }

    // 2. Explicit NAMED request → create with that name, overriding any
    //    previous scope or 'off' state (user is clearly asking for this).
    const explicit = this.detector.detectExplicitFolderRequest(promptText)
    if (explicit) {
      const res = await this.api?.taskScopeCreateFolder?.(ws, explicit.name)
      if (!res?.ok) return { acted: 'failed', reason: res?.reason || 'unknown' }
      this.store.setScope(res.path, 'manual')
      this.toast(`📁 Using ${explicit.name} as you asked`, false)
      this.onChange()
      return { acted: 'created-explicit', path: res.path, name: explicit.name }
    }

    // 3. Scope already set → respect it (don't stomp).
    if (this.store.hasScope()) return { acted: 'skipped-has-scope' }

    // 4. Mode was explicitly 'off' from a previous × click.
    //    - Creation prompt with intent → treat as new task, auto-create anyway
    //    - Anything else → respect the off decision
    const mode = this.store.getScopeMode()
    const hasIntent = this.detector.hasCreationIntent(promptText)
    if (mode === 'off' && !hasIntent) return { acted: 'skipped-off' }

    // 5. Existing project? Respect that — don't isolate new tasks inside
    //    someone's real work. One-time info toast per workspace.
    if (await this.detector.looksLikeProject(ws)) {
      if (!this._seenProjects.has(ws)) {
        this._seenProjects.add(ws)
        // Subtle — this is the normal case for editing, not a warning.
      }
      return { acted: 'skipped-project' }
    }

    // 6. No creation intent → this prompt is editing/asking/reading, not
    //    starting new work. Don't spawn a folder for it. (Reuses the
    //    `hasIntent` we computed above.)
    if (!hasIntent) return { acted: 'skipped-no-intent' }

    // 7. Safety net for trivial prompts that somehow passed the intent check
    //    (e.g. the single word "build").
    if (this.detector.isTrivialPrompt(promptText)) {
      return { acted: 'skipped-trivial' }
    }

    // 8. All clear — create.
    const slug = this.detector.slugForPrompt(promptText)
    const res = await this.api?.taskScopeCreateFolder?.(ws, slug)
    if (!res?.ok) return { acted: 'failed', reason: res?.reason || 'unknown' }
    this.store.setScope(res.path, 'auto')
    this.toast(`📁 Created ${slug} — keeping this task organized`, false)
    this.onChange()
    return { acted: 'created-auto', path: res.path, name: slug }
  }
}
