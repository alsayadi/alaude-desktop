// Task Scope bootstrap — wires ScopeStore + ScopeUI together and exposes
// the window.* bridges inline index.html code uses.
//
// Intentional separation from the memory bootstrap: task scope is an
// independent subsystem (workspace-bar UI, session field, send-flow patch).
// Keeping it in its own bootstrap keeps the two from growing a shared
// dependency graph.

import { ScopeStore } from './scope-store.js'
import { ScopeUI } from './scope-ui.js'
import { ScopeDetector } from './scope-detector.js'
import { ScopeAutoCreator } from './scope-auto.js'

export function bootTaskScope({
  getSession,          // () => current session object
  getWorkspace,        // () => string | null   (workspacePath global)
  toast,               // (msg, isError?) => void
  onChange,            // () => void  — called when scope mutates (persist + render)
} = {}) {
  const store = new ScopeStore({
    getSession,
    onChange: () => { try { onChange?.() } catch {} },
  })
  const ui = new ScopeUI({
    store,
    getWorkspace,
    toast,
  })
  const detector = new ScopeDetector()
  const autoCreator = new ScopeAutoCreator({
    store, detector, getWorkspace, toast,
    onChange: () => { try { onChange?.() } catch {} },
  })

  const win = globalThis.window || globalThis

  // Data-layer bridges (read-only — scope mutations go through the UI).
  win.__taskScopeStore = store
  // Reads used by send-flow:
  win.__taskScopeActive = () => store.getScopePath()
  win.__taskScopeMode = () => store.getScopeMode()
  win.__taskScopeHas = () => store.hasScope()
  // Build the system-prompt hint when scope is active.
  win.__taskScopeSystemPromptHint = () => {
    const p = store.getScopePath()
    if (!p) return ''
    const short = store.getShortName()
    return `\n\n<task-scope>\nYour working directory for this session is \`${p}\` (scope name: ${short}). Create all new files inside this directory. Do not write files above this path unless the user explicitly asks.\n</task-scope>`
  }

  // v0.7.37: only two UI bridges — render (for state refresh) and clear
  // (for the × button inside the breadcrumb). No create / prompt dialogs —
  // the auto-creator decides everything, the user just sees the result
  // and can × it to opt out for the current session.
  win.__taskScopeUI = ui
  win.taskScopeRender = () => ui.render()

  // v0.7.32 auto-creator bridge — called by send-flow on every user message.
  // Returns the decision object; toast feedback is internal.
  win.__taskScopeMaybeAutoCreate = (promptText) =>
    autoCreator.maybeAutoCreate(promptText)

  return { store, ui, detector, autoCreator }
}
