// ProfileStore — always-on "About You" facts.
//
// Different from MemoryStore in three important ways:
//   1. Small and bounded: 20 entries, 200 chars each.
//   2. Always injected (not retrieved) — every turn sees the full block.
//   3. No embeddings. No scope. Plain list grouped by category.
//
// Shape of an entry:
//   { id, text, category, createdAt }
//
// Categories are freeform strings, but PROFILE_CATEGORIES is the
// canonical set used by the UI and the system-block renderer. Unknown
// categories still render, just appended at the end.

import { PROFILE_CATEGORIES } from '../memory/memory-extract.js'

const LS_KEY = 'alaude:profile:v1'
const LS_ONBOARDED_KEY = 'alaude:profile:onboarded:v1'
const MAX_ENTRIES = 20
const MAX_CHARS = 200

function _normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ')
}

export class ProfileStore {
  constructor({ storage = localStorage } = {}) {
    this.storage = storage
    this.entries = this._load()
  }

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

  // ── onboarding flag ───────────────────────────────────────────
  hasOnboarded() {
    try { return this.storage.getItem(LS_ONBOARDED_KEY) === '1' } catch { return false }
  }
  markOnboarded() {
    try { this.storage.setItem(LS_ONBOARDED_KEY, '1') } catch {}
  }
  shouldShowOnboarding() {
    return !this.hasOnboarded() && this.entries.length === 0
  }

  // ── CRUD ──────────────────────────────────────────────────────
  all() { return this.entries }
  size() { return this.entries.length }
  find(id) { return this.entries.find(e => e.id === id) || null }

  add(text, category = 'context') {
    const t = String(text || '').trim()
    if (!t || t.length > MAX_CHARS) return null
    const cat = String(category || 'context').trim() || 'context'
    const norm = _normalize(t)
    if (this.entries.some(p => p.category === cat && _normalize(p.text) === norm)) return null
    // At the cap: drop oldest of same category first, then oldest overall.
    if (this.entries.length >= MAX_ENTRIES) {
      const sameCat = this.entries
        .filter(p => p.category === cat)
        .sort((a, b) => a.createdAt - b.createdAt)
      if (sameCat.length) {
        this.entries = this.entries.filter(p => p.id !== sameCat[0].id)
      } else {
        this.entries.sort((a, b) => a.createdAt - b.createdAt).shift()
      }
    }
    const entry = {
      id: 'pf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text: t,
      category: cat,
      createdAt: Date.now(),
    }
    this.entries.push(entry)
    this.save()
    return entry
  }

  edit(id, newText) {
    const p = this.find(id)
    if (!p) return false
    const t = String(newText || '').trim()
    if (!t) return false
    p.text = t.slice(0, MAX_CHARS)
    this.save()
    return true
  }

  remove(id) {
    this.entries = this.entries.filter(p => p.id !== id)
    this.save()
  }

  clearAll() {
    this.entries = []
    this.save()
  }

  // Grouping helper for UI rendering — returns a dictionary keyed by
  // category, values preserve insertion order within a category.
  groupedByCategory() {
    const byCat = {}
    for (const p of this.entries) (byCat[p.category] ||= []).push(p)
    const order = PROFILE_CATEGORIES.map(c => c.id)
    for (const k of Object.keys(byCat)) if (!order.includes(k)) order.push(k)
    const out = []
    for (const cat of order) {
      if (!byCat[cat]) continue
      const meta = PROFILE_CATEGORIES.find(c => c.id === cat) || { id: cat, label: cat }
      out.push({ category: cat, meta, entries: byCat[cat] })
    }
    return out
  }

  // Build the <user-profile> block prepended to the last user message every
  // turn. Returns '' when empty so the caller can skip injection entirely.
  getSystemBlock() {
    if (!this.entries.length) return ''
    const lines = []
    for (const group of this.groupedByCategory()) {
      // "👤 Identity" → "Identity" for the prompt block so the model gets
      // clean ASCII — emojis can confuse tokenization on some providers.
      const catLabel = group.meta.label.replace(/^[^\s]+\s/, '')
      for (const p of group.entries) lines.push(`- [${catLabel}] ${p.text}`)
    }
    if (!lines.length) return ''
    return '<user-profile>\n' + lines.join('\n') + '\n</user-profile>\n\n'
  }
}
