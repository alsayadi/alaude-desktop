// ScopeStore — per-session task scope state.
//
// Task Scope is a subfolder of the picked workspace that a chat session
// "owns". When a session has a taskScope set, the model sees that subfolder
// as its workspace — every write_file, every run_command runs inside it,
// and the containedPath() guard keeps tool writes from escaping.
//
// This class does NOT own session persistence — `sessions` array lives in
// index.html and is saved via persistSessions(). ScopeStore reads + writes
// the `taskScope` and `taskScopeMode` fields on session objects and defers
// to the caller for persistence (because sessions already batch writes).
//
// Shape extension to session objects (additive, backward-compatible):
//   {
//     ...existing session fields...,
//     taskScope?: string,           // absolute path of the subfolder
//     taskScopeMode?: 'manual' | 'auto' | 'off',
//   }
// Missing fields on legacy sessions → treated as 'off', no scope.

export class ScopeStore {
  constructor({ getSession, onChange } = {}) {
    // getSession() → current session object (or null). Called lazily so we
    // always read the freshest version, not a captured reference.
    this.getSession = getSession || (() => null)
    // onChange() → called after any scope mutation so the caller (usually
    // bootstrap/UI) can persistSessions() + refresh the breadcrumb.
    this.onChange = onChange || (() => {})
  }

  // ── reads ────────────────────────────────────────────────────
  // Active scope path for the current session, or null. This is the value
  // the send-flow should use as `workspacePath` when present.
  getScopePath() {
    const s = this.getSession()
    if (!s) return null
    if (s.taskScopeMode === 'off') return null
    return s.taskScope || null
  }
  getScopeMode() {
    const s = this.getSession()
    return s?.taskScopeMode || (s?.taskScope ? 'manual' : 'off')
  }
  hasScope() {
    return !!this.getScopePath()
  }

  // ── writes (caller must still trigger persistence via onChange) ──
  setScope(absPath, mode = 'manual') {
    const s = this.getSession()
    if (!s) return false
    s.taskScope = absPath || null
    s.taskScopeMode = absPath ? mode : 'off'
    this.onChange()
    return true
  }
  clearScope() {
    const s = this.getSession()
    if (!s) return
    s.taskScope = null
    s.taskScopeMode = 'off'
    this.onChange()
  }

  // ── helpers ──────────────────────────────────────────────────
  // Short breadcrumb label, e.g. "scratch › todo-app-20260420"
  // parentLabel = last segment of workspace path
  // Just the scope folder name; the caller handles the full breadcrumb render.
  getShortName() {
    const p = this.getScopePath()
    if (!p) return ''
    const parts = p.split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || ''
  }

  // v0.7.32 / v0.7.33: should we SKIP auto-create for this session? Yes if:
  //   - session already has a scope (any mode: manual, auto, …) — don't stomp
  //   - user explicitly cleared ('off') — respect the opt-out
  // Anything else = no decision yet = eligible for auto-create.
  hasExplicitDecision() {
    if (this.hasScope()) return true        // any scope already set
    return this.getScopeMode() === 'off'    // user cleared
  }
}
