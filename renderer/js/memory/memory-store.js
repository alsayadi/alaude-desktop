// MemoryStore — data layer for episodic memory.
//
// Owns:
//   - the array of memory entries (in-memory cache + localStorage backing)
//   - add / remove / edit / list / toggleScope
//   - the scope-aware "visible pool" used by the recall layer
//   - embeddings mutation (read-only from the outside; memory-embeddings.js
//     writes via the public setEmbedding method so we keep a single save path)
//
// Does NOT own:
//   - recall scoring (delegated to MemoryRecall — semantic + keyword lives there)
//   - UI rendering (delegated to MemoryUI)
//   - extraction regexes (delegated to MemoryExtract)
//
// Shape of an entry:
//   { id, text, createdAt, source, scope, workspacePath, embedding?, embedModel? }
//   - source:      { sessionId, msgIdx } | null
//   - scope:       'global' | 'workspace'        (legacy entries default to 'global')
//   - workspacePath: absolute fs path | null
//
// Caps (kept identical to the original inline implementation):
//   - per-entry: 1000 chars
//   - total:     500 entries (drops oldest when exceeded)

const LS_KEY = 'alaude:memory:v1'
const LS_MODE_KEY = 'alaude:memory-recall-mode:v1'
const MAX_ENTRIES = 500
const MAX_CHARS = 1000

function _normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ')
}

export class MemoryStore {
  constructor({ storage = localStorage } = {}) {
    this.storage = storage
    this.entries = this._load()
    this.recallMode = this.storage.getItem(LS_MODE_KEY) || 'auto'
  }

  // ── persistence ────────────────────────────────────────────────
  _load() {
    try {
      const raw = this.storage.getItem(LS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  save() {
    try { this.storage.setItem(LS_KEY, JSON.stringify(this.entries)) } catch {}
  }
  setRecallMode(mode) {
    this.recallMode = mode
    try { this.storage.setItem(LS_MODE_KEY, mode) } catch {}
  }

  // ── reads ──────────────────────────────────────────────────────
  all() { return this.entries }
  size() { return this.entries.length }
  find(id) { return this.entries.find(e => e.id === id) || null }

  // Scope-aware candidate pool used by recall AND by the modal for counts.
  // An entry is visible if it is 'global' OR if its scope is 'workspace'
  // AND its workspacePath matches `currentWorkspace`. Legacy entries (no
  // scope field) are treated as 'global' for full backward compat.
  visiblePool(currentWorkspace) {
    return this.entries.filter(m => {
      const scope = m.scope || 'global'
      if (scope === 'global') return true
      if (scope === 'workspace') {
        if (!currentWorkspace) return false
        return m.workspacePath === currentWorkspace
      }
      return false
    })
  }

  // ── writes ─────────────────────────────────────────────────────
  // Add a memory. Returns the new entry or null if skipped (duplicate,
  // empty, or over MAX_CHARS).
  //
  // opts:
  //   scope:         'global' | 'workspace'  (default: 'global' unless
  //                  workspacePath was passed explicitly)
  //   workspacePath: absolute fs path. When scope='workspace' and this is
  //                  omitted, caller can pass it via the getCurrentWorkspace
  //                  helper (see MemoryUI).
  add(text, source = null, opts = {}) {
    const t = String(text || '').trim()
    if (!t || t.length > MAX_CHARS) return null
    const norm = _normalize(t)
    if (this.entries.some(e => _normalize(e.text) === norm)) return null

    const hasPathOpt = typeof opts.workspacePath === 'string' && opts.workspacePath
    const scope = opts.scope || (hasPathOpt ? 'workspace' : 'global')
    const ws = scope === 'workspace' ? (opts.workspacePath || null) : null

    const entry = {
      id: 'mem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text: t,
      createdAt: Date.now(),
      source: source || null,
      scope,
      workspacePath: ws,
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES)
    this.save()
    return entry
  }

  edit(id, newText) {
    const e = this.find(id)
    if (!e) return false
    const t = String(newText || '').trim()
    if (!t) return false
    e.text = t.slice(0, 240)  // legacy truncation — edit keeps the old limit
    this.save()
    return true
  }

  remove(id) {
    this.entries = this.entries.filter(e => e.id !== id)
    this.save()
  }

  clearAll() {
    this.entries = []
    this.save()
  }

  // Flip an entry between global and workspace. Returns the new scope or
  // null if no change (e.g. trying to scope-to-workspace with none active).
  toggleScope(id, currentWorkspace) {
    const e = this.find(id)
    if (!e) return null
    const cur = e.scope || 'global'
    if (cur === 'global') {
      if (!currentWorkspace) return null
      e.scope = 'workspace'
      e.workspacePath = currentWorkspace
    } else {
      e.scope = 'global'
      e.workspacePath = null
    }
    this.save()
    return e.scope
  }

  // ── embeddings mutation (called by memory-embeddings.js) ──────
  setEmbedding(id, vector, model) {
    const e = this.find(id)
    if (!e) return
    e.embedding = vector
    e.embedModel = model
    this.save()
  }
  setEmbeddingsBatch(pairs) {
    // pairs: [{ id, vector, model }]
    for (const { id, vector, model } of pairs) {
      const e = this.find(id)
      if (!e) continue
      e.embedding = vector
      e.embedModel = model
    }
    this.save()
  }
  // Entries that need embedding backfill (force=true returns everything).
  pendingEmbed(force = false) {
    return this.entries.filter(m => force || !Array.isArray(m.embedding) || !m.embedding.length)
  }
  embeddedCount() {
    return this.entries.filter(m => Array.isArray(m.embedding) && m.embedding.length).length
  }
}
