// ScopeUI — passive breadcrumb.
//
// v0.7.37 simplification: no more manual create button, no prompt dialogs,
// no rename. The scope is decided automatically by the send-flow (see
// ScopeAutoCreator). This UI ONLY reflects state — it doesn't offer
// create affordances.
//
// What this class owns:
//   - Rendering `#task-scope-breadcrumb` when a scope is active
//   - Handling the × button inside the breadcrumb to clear scope for this
//     session (sets mode='off' so auto-create stays out of the way)
//   - Hiding everything when there's no workspace or no scope
//
// What it no longer owns (removed in v0.7.37):
//   - The 📁+ create button (HTML element removed too)
//   - The prompt() dialog for manual naming
//   - Any inline override UI

export class ScopeUI {
  constructor({ store, getWorkspace, toast }) {
    this.store = store
    this.getWorkspace = getWorkspace
    this.toast = toast || (() => {})
  }

  _shortName(p) {
    if (!p) return ''
    const parts = String(p).split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || p
  }

  // Called on: workspace pick, session switch, scope mutation, app boot.
  render() {
    const crumb = document.getElementById('task-scope-breadcrumb')
    if (!crumb) return
    const ws = this.getWorkspace()
    const scopePath = this.store.getScopePath()
    if (!ws || !scopePath) {
      crumb.style.display = 'none'
      crumb.innerHTML = ''
      return
    }
    // Active scope — paint the breadcrumb.
    crumb.style.display = ''
    const name = this._shortName(scopePath)
    crumb.innerHTML = `<span class="task-scope-arrow">›</span><span class="task-scope-name" title="${this._escAttr(scopePath)}">${this._escHtml(name)}</span><button class="task-scope-clear" title="Stop using this subfolder — new files will go to workspace root" onclick="window.__taskScopeUI?.clear()">×</button>`
  }

  // Clears the session's scope and marks it 'off' so auto-create respects
  // the decision on subsequent messages in this session.
  clear() {
    if (!this.store.hasScope()) return
    this.store.clearScope()
    this.toast('📁 Task scope cleared — new files go to workspace root.', false)
    this.render()
  }

  _escHtml(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])) }
  _escAttr(s) { return this._escHtml(s) }
}
