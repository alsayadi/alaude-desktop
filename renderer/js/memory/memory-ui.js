// MemoryUI — imperative DOM code for Memory Lens modal.
//
// Reads from MemoryStore + ProfileStore (passed in), renders into the
// existing HTML modal in index.html (not created here — we don't own the
// modal skeleton, just the body contents).
//
// Context deps (injected by bootstrap):
//   - getWorkspace()   → current workspace path or null
//   - toast(msg, err?) → show a transient toast
//   - escapeHtml(s)    → HTML-escape a string (shared with the main script)

export class MemoryUI {
  constructor({
    store,
    embeddings,
    recall,
    profileStore,
    getWorkspace,
    getIncognito,
    setIncognito,
    toast,
    escapeHtml,
  }) {
    this.store = store
    this.embeddings = embeddings
    this.recall = recall
    this.profileStore = profileStore
    this.getWorkspace = getWorkspace
    this.getIncognito = getIncognito
    this.setIncognito = setIncognito
    this.toast = toast || (() => {})
    this.escapeHtml = escapeHtml || ((s) => s)
    this.scopeFilter = 'all'    // 'all' | 'global' | 'workspace' — not persisted
  }

  // ── helpers ──────────────────────────────────────────────────
  _shortWsLabel(p) {
    if (!p) return ''
    const parts = String(p).split(/[\\/]/).filter(Boolean)
    return parts.slice(-2).join('/') || p
  }
  _badge(m) {
    const scope = m.scope || 'global'
    if (scope === 'global') {
      return `<span class="mem-badge mem-badge-global" title="Visible from any workspace">🌐 Global</span>`
    }
    const ws = m.workspacePath || ''
    const label = this._shortWsLabel(ws) || '?'
    const isCurrent = this.getWorkspace() && ws === this.getWorkspace()
    const esc = this.escapeHtml
    return `<span class="mem-badge mem-badge-workspace${isCurrent ? ' mem-badge-current' : ''}" title="${esc(ws)}">📁 ${esc(label)}${isCurrent ? '' : ' (other)'}</span>`
  }

  // ── modal open/close ─────────────────────────────────────────
  toggleModal() {
    const m = document.getElementById('memory-modal')
    if (!m) return
    const isOpen = m.classList.contains('show') || m.style.display === 'flex'
    if (isOpen) {
      m.classList.remove('show')
      m.style.display = 'none'
      return
    }
    // Default the bulk-scope selector + incognito checkbox based on state
    const scopeSel = document.getElementById('memory-bulk-scope')
    if (scopeSel) scopeSel.value = this.getWorkspace() ? 'workspace' : 'global'
    const chk = document.getElementById('memory-incognito-check')
    if (chk) chk.checked = !!this.getIncognito()
    this.renderProfileList()
    this.renderList()
    this.refreshSemanticStatus()
    m.classList.add('show')
    m.style.display = 'flex'
    // Onboarding — delegated to caller via window.__profileUI so the two
    // modals stay decoupled.
    if (this.profileStore.shouldShowOnboarding() && window.__profileUI?.showOnboarding) {
      setTimeout(() => window.__profileUI.showOnboarding(), 250)
    }
  }

  setScopeFilter(f) {
    this.scopeFilter = f
    ;['all','global','workspace'].forEach(k => {
      const el = document.getElementById('memory-tab-' + k)
      if (el) el.classList.toggle('active', k === f)
    })
    this.renderList()
  }

  // ── list rendering ───────────────────────────────────────────
  renderList() {
    const list = document.getElementById('memory-modal-list')
    const count = document.getElementById('memory-count')
    if (!list) return
    const esc = this.escapeHtml
    const ws = this.getWorkspace()

    const q = (document.getElementById('memory-search')?.value || '').trim().toLowerCase()

    // Tab counts reflect everything in the store, not the current filter.
    const counts = { all: this.store.size(), global: 0, workspace: 0 }
    for (const m of this.store.all()) {
      const scope = m.scope || 'global'
      if (scope === 'global') counts.global++
      else if (scope === 'workspace' && ws && m.workspacePath === ws) counts.workspace++
    }
    const tAll = document.getElementById('memory-tab-all')
    const tGlobal = document.getElementById('memory-tab-global')
    const tWs = document.getElementById('memory-tab-workspace')
    if (tAll) tAll.innerHTML = `All <span class="tab-count">${counts.all}</span>`
    if (tGlobal) tGlobal.innerHTML = `🌐 Global <span class="tab-count">${counts.global}</span>`
    if (tWs) {
      const wsLabel = ws ? this._shortWsLabel(ws) : 'This workspace'
      tWs.innerHTML = `📁 ${esc(wsLabel)} <span class="tab-count">${counts.workspace}</span>`
      tWs.title = ws || 'No workspace active'
    }

    const ordered = [...this.store.all()].sort((a, b) => b.createdAt - a.createdAt)
    const scopeFiltered = ordered.filter(m => {
      const scope = m.scope || 'global'
      if (this.scopeFilter === 'all') return true
      if (this.scopeFilter === 'global') return scope === 'global'
      if (this.scopeFilter === 'workspace') return scope === 'workspace' && ws && m.workspacePath === ws
      return true
    })
    const filtered = q ? scopeFiltered.filter(m => m.text.toLowerCase().includes(q)) : scopeFiltered

    if (count) {
      count.textContent = q
        ? `${filtered.length} of ${this.store.size()}`
        : `${filtered.length} / 500`
    }

    if (!this.store.size()) {
      list.innerHTML = `<div style="color:var(--text-faint);font-size:13px;padding:20px;text-align:center">No memories yet. Click "🧠 Remember" on any user message, type "Remember that I prefer X" in chat, or use the Add/Import panel below.</div>`
      return
    }
    if (!filtered.length) {
      const hint = this.scopeFilter === 'workspace' && !ws
        ? 'Open a workspace folder first to see workspace-scoped memories.'
        : `No memories match this filter${q ? ` / "${esc(q)}"` : ''}.`
      list.innerHTML = `<div style="color:var(--text-faint);font-size:13px;padding:20px;text-align:center">${hint}</div>`
      return
    }

    // Split "this workspace + globals" from "other workspaces" so orphans
    // don't clutter the active view. Only applies on the All tab.
    const currentOrGlobal = []
    const otherWorkspaces = []
    for (const m of filtered) {
      const scope = m.scope || 'global'
      if (scope === 'global') { currentOrGlobal.push(m); continue }
      if (ws && m.workspacePath === ws) { currentOrGlobal.push(m); continue }
      otherWorkspaces.push(m)
    }
    const renderRow = (m) => {
      const when = new Date(m.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
      const src = m.source ? 'session' : 'manual'
      return `<div class="memory-row">
        <div style="flex:1;min-width:0">
          <div class="memory-row-text">${esc(m.text)}</div>
          <div class="memory-row-meta">${this._badge(m)} · ${when} · ${src}</div>
        </div>
        <button class="msg-action-btn" onclick="window.__memUI.toggleScope('${esc(m.id)}')" title="Toggle global / workspace scope">⇄</button>
        <button class="msg-action-btn" onclick="window.__memUI.editEntry('${esc(m.id)}')">Edit</button>
        <button class="msg-action-btn" onclick="window.__memUI.deleteEntry('${esc(m.id)}')">×</button>
      </div>`
    }
    let html = currentOrGlobal.map(renderRow).join('')
    if (otherWorkspaces.length && this.scopeFilter === 'all') {
      html += `<div class="memory-section-header">Other workspaces (${otherWorkspaces.length})</div>`
      html += otherWorkspaces.map(renderRow).join('')
    }
    list.innerHTML = html
  }

  // ── row actions ──────────────────────────────────────────────
  toggleScope(id) {
    const ws = this.getWorkspace()
    const newScope = this.store.toggleScope(id, ws)
    if (newScope === null) {
      this.toast('Open a workspace folder first to scope this memory to it.', true)
      return
    }
    if (newScope === 'workspace') {
      this.toast(`📁 Scoped to ${this._shortWsLabel(ws)}`, false)
    } else {
      this.toast('🌐 Now global (visible in all workspaces)', false)
    }
    this.renderList()
  }
  editEntry(id) {
    const e = this.store.find(id)
    if (!e) return
    const edited = prompt('Edit memory:', e.text)
    if (edited == null) return
    if (this.store.edit(id, edited)) this.renderList()
  }
  deleteEntry(id) {
    if (!confirm('Delete this memory?')) return
    this.store.remove(id)
    this.renderList()
  }
  clearAll() {
    if (!confirm("Delete ALL memories? This can't be undone.")) return
    this.store.clearAll()
    this.renderList()
  }

  // ── capture from the chat stream (invoked by bootstrap handlers) ─
  // The Remember button lives on rendered user messages — defaults to
  // workspace scope; Shift-click forces global.
  rememberMessage(idx, ev, { messages, currentSessionId }) {
    const m = messages?.[idx]
    if (!m || m.role !== 'user' || !m.content) return
    const t = m.content.length > 220 ? m.content.slice(0, 217) + '…' : m.content
    const forceGlobal = !!(ev && ev.shiftKey)
    const ws = this.getWorkspace()
    const scope = forceGlobal ? 'global' : (ws ? 'workspace' : 'global')
    const added = this.store.add(
      t,
      { sessionId: currentSessionId, msgIdx: idx },
      { scope, workspacePath: scope === 'workspace' ? ws : null }
    )
    if (added) {
      const badge = scope === 'workspace' ? '📁' : '🌐'
      this.toast(`🧠 Remembered ${badge}: "` + added.text.slice(0, 60) + (added.text.length > 60 ? '…' : '') + '"', false)
      // Fire-and-forget embed
      this.embeddings.ensureForEntry(added).catch(() => {})
    } else {
      this.toast('Already remembered (or empty/too long)', false)
    }
  }

  // ── bulk add / import / export ───────────────────────────────
  addBulk() {
    const ta = document.getElementById('memory-bulk-input')
    if (!ta) return
    const sel = document.getElementById('memory-bulk-scope')
    const chosen = sel?.value || (this.getWorkspace() ? 'workspace' : 'global')
    const ws = this.getWorkspace()
    const scope = (chosen === 'workspace' && ws) ? 'workspace' : 'global'
    const raw = ta.value || ''
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    let added = 0, skipped = 0
    for (const line of lines) {
      const ok = this.store.add(line, null, { scope, workspacePath: scope === 'workspace' ? ws : null })
      if (ok) { added++; this.embeddings.ensureForEntry(ok).catch(() => {}) }
      else skipped++
    }
    ta.value = ''
    this.renderList()
    const badge = scope === 'workspace' ? '📁' : '🌐'
    this.toast(`🧠 Added ${added} memories ${badge}${skipped ? ` (${skipped} skipped — duplicate or too long)` : ''}`, false)
  }

  importFile() { document.getElementById('memory-import-input')?.click() }

  async importFromInput(ev) {
    const file = ev.target?.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      let added = 0, skipped = 0
      // Imports default to GLOBAL — typical imports are portable knowledge
      // that the user wants available in every workspace.
      const addOne = (t) => {
        const e = this.store.add(t, null, { scope: 'global' })
        if (e) { added++; this.embeddings.ensureForEntry(e).catch(() => {}) }
        else skipped++
      }
      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const t = typeof item === 'string' ? item : item?.text
              if (t) addOne(t); else skipped++
            }
          }
        } catch {
          this.toast('❌ Invalid JSON', true)
          return
        }
      } else {
        const lines = text.split(/\r?\n/)
          .map(l => l.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
          .filter(Boolean)
        for (const line of lines) addOne(line)
      }
      this.renderList()
      this.toast(`🧠 Imported ${added} memories from ${file.name}${skipped ? ` (${skipped} skipped)` : ''}`, false)
    } catch (err) {
      this.toast(`❌ Import failed: ${err.message}`, true)
    } finally {
      ev.target.value = ''
    }
  }

  exportAll() {
    const all = this.store.all()
    if (!all.length) { this.toast('No memories to export', false); return }
    const content = [...all]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(m => m.text)
      .join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `labaik-memories-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.toast(`📤 Exported ${all.length} memories`, false)
  }

  // ── semantic recall status + re-index ────────────────────────
  async refreshSemanticStatus() {
    const icon = document.getElementById('memory-semantic-icon')
    const text = document.getElementById('memory-semantic-text')
    const modeSel = document.getElementById('memory-recall-mode')
    const btn = document.getElementById('memory-reindex-btn')
    if (!icon || !text) return
    if (modeSel) modeSel.value = this.store.recallMode
    const model = await this.embeddings.detectModel()
    const esc = this.escapeHtml
    if (!model) {
      icon.textContent = '🔎'
      text.innerHTML = `Semantic recall off — install <code>all-minilm</code> (≈45 MB, runs locally) for smarter memory matching. <button class="msg-action-btn" onclick="window.__memUI.installEmbedModel()" style="margin-left:8px;font-size:11px">Install (45 MB)</button>`
      if (btn) btn.disabled = true
      return
    }
    const embedded = this.store.embeddedCount()
    const total = this.store.size()
    icon.textContent = '🧭'
    if (total === 0) {
      text.innerHTML = `Semantic recall ready (<code>${esc(model)}</code>) — add some memories to get going.`
    } else if (embedded === total) {
      text.innerHTML = `<strong>Semantic recall active</strong> — ${embedded}/${total} memories indexed with <code>${esc(model)}</code>.`
    } else {
      text.innerHTML = `${embedded}/${total} memories indexed with <code>${esc(model)}</code>. Click Re-index to backfill the rest.`
    }
    if (btn) btn.disabled = false
  }

  setRecallMode(mode) {
    this.store.setRecallMode(mode)
    this.toast(`🧠 Memory recall: ${mode}`, false)
  }

  async installEmbedModel() {
    const text = document.getElementById('memory-semantic-text')
    const r = await this.embeddings.installDefaultModel({
      onProgressText: (s) => { if (text) text.textContent = s },
    })
    if (!r.ok) {
      if (r.reason === 'ollama-down') {
        this.toast("Ollama isn't running. Open Local Models to install it first.", true)
      } else {
        this.toast(`Install failed: ${r.error || r.reason}`, true)
      }
      this.refreshSemanticStatus()
      return
    }
    await this.refreshSemanticStatus()
    this.toast('🧭 Embedding model installed. Indexing…', false)
    if (this.store.size()) await this.reindex()
  }

  async reindex() {
    const btn = document.getElementById('memory-reindex-btn')
    const text = document.getElementById('memory-semantic-text')
    if (!btn || btn.disabled) return
    btn.disabled = true
    const original = btn.textContent
    btn.textContent = 'Indexing…'
    try {
      const r = await this.embeddings.ensureAll({
        force: true,
        onProgress: ({ done, total }) => { if (text) text.textContent = `Indexing ${done}/${total}…` },
      })
      if (r.reason === 'no-model') {
        this.toast('No embedding model installed', true)
      } else {
        this.toast(`🧭 Indexed ${this.store.size()} memories`, false)
      }
    } finally {
      btn.disabled = false
      btn.textContent = original
      this.refreshSemanticStatus()
      this.renderList()
    }
  }

  // ── incognito ─────────────────────────────────────────────────
  onIncognitoChange(on) {
    this.setIncognito(!!on)
    const chk = document.getElementById('memory-incognito-check')
    if (chk) chk.checked = !!on
    const lbl = document.getElementById('memory-incognito-toggle')
    if (lbl) lbl.style.background = on ? 'rgba(200,100,100,0.15)' : ''
    this.toast(on ? '🕶️ Incognito: profile + memories paused' : '🧠 Memory active again', false)
  }

  // ── profile list (rendered inside the same modal) ─────────────
  renderProfileList() {
    const list = document.getElementById('profile-list')
    const count = document.getElementById('profile-count')
    if (count) count.textContent = `${this.profileStore.size()}/20`
    if (!list) return
    if (!this.profileStore.size()) {
      list.innerHTML = `<div style="color:var(--text-faint);font-size:11.5px;font-style:italic">Empty. Add a fact below to have Labaik remember it in every conversation.</div>`
      return
    }
    const esc = this.escapeHtml
    let html = ''
    for (const group of this.profileStore.groupedByCategory()) {
      for (const p of group.entries) {
        html += `<div class="profile-row">
          <span class="profile-cat">${esc(group.meta.label)}</span>
          <span class="profile-text" ondblclick="window.__profileUI.editInline('${esc(p.id)}')" title="Double-click to edit">${esc(p.text)}</span>
          <button class="msg-action-btn profile-row-btn" onclick="window.__profileUI.editInline('${esc(p.id)}')" title="Edit">✎</button>
          <button class="msg-action-btn profile-row-btn" onclick="window.__profileUI.removeAndRefresh('${esc(p.id)}')" title="Remove">×</button>
        </div>`
      }
    }
    list.innerHTML = html
  }
}
