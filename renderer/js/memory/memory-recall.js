// MemoryRecall — scoring + retrieval + prompt injection.
//
// Three recall modes:
//   'semantic'  → cosine-only, no keyword fallback
//   'keyword'   → keyword-only, never runs embeddings
//   'auto'      → try semantic first, fall back to keyword if none matched
//                 or the embed model is unavailable
//
// Noise floor for cosine is 0.35 — empirically tuned to keep recall relevant
// without being so strict it returns nothing in the 'auto' path.

import { MemoryEmbeddings } from './memory-embeddings.js'

const STOPWORDS = new Set([
  'that','this','with','from','have','will','what','when','where','which',
  'should','could','would','about','there','their','been','does','doesnt',
  'cant','dont','just','like','some','also','make','makes','need','needs',
])
const NOISE_FLOOR = 0.35
const TOP_N_DEFAULT = 5

function _words(text) {
  return new Set(
    String(text).toLowerCase().match(/[a-z]{4,}/g)?.filter(w => !STOPWORDS.has(w)) || []
  )
}

export class MemoryRecall {
  constructor({ store, embeddings, getIncognito = () => false, getCurrentWorkspace = () => null } = {}) {
    this.store = store
    this.embeddings = embeddings
    this.getIncognito = getIncognito
    this.getCurrentWorkspace = getCurrentWorkspace
  }

  keywordScore(queryText) {
    const q = _words(queryText)
    if (!q.size) return []
    return this.store.visiblePool(this.getCurrentWorkspace()).map(m => {
      const mw = _words(m.text)
      let s = 0
      for (const w of q) if (mw.has(w)) s++
      return { m, s }
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s)
  }

  async semanticScore(queryText) {
    const model = await this.embeddings.detectModel()
    if (!model) return null
    const pool = this.store.visiblePool(this.getCurrentWorkspace())
    const embedded = pool.filter(m => Array.isArray(m.embedding) && m.embedding.length)
    if (!embedded.length) return null
    const qvec = await this.embeddings.embedOne(queryText)
    if (!qvec) return null
    return embedded
      .map(m => ({ m, s: MemoryEmbeddings.cosine(qvec, m.embedding) }))
      .filter(x => x.s > NOISE_FLOOR)
      .sort((a, b) => b.s - a.s || b.m.createdAt - a.m.createdAt)
  }

  // Top-N memory objects, gated by mode + incognito.
  async recall(queryText, topN = TOP_N_DEFAULT) {
    if (!queryText || !this.store.size()) return []
    if (this.getIncognito()) return []
    const mode = this.store.recallMode || 'auto'
    if (mode !== 'keyword') {
      const sem = await this.semanticScore(queryText)
      if (sem && sem.length) return sem.slice(0, topN).map(x => x.m)
    }
    if (mode === 'semantic') return []     // explicit semantic-only → no fallback
    const kw = this.keywordScore(queryText)
    return kw.slice(0, topN).map(x => x.m)
  }

  // Given a sanitized message history and a query, prepend the user-profile
  // block (always-on) and the memory-context block (retrieval-gated) to the
  // last user message. Both blocks travel together so Anthropic's rejection
  // of role='system' in messages[] doesn't break us — it's one inline prefix.
  //
  // profileBlockBuilder: () => string  (caller-supplied; usually ProfileStore.getSystemBlock)
  async injectIntoLastUser(cleanMsgs, queryText, profileBlockBuilder = () => '') {
    if (!cleanMsgs || !cleanMsgs.length) return { msgs: cleanMsgs, used: [], profileUsed: false }
    const profileBlock = this.getIncognito() ? '' : (profileBlockBuilder() || '')
    const used = await this.recall(queryText, TOP_N_DEFAULT)
    const memBlock = used.length
      ? '<memory-context>\n' + used.map(m => `- ${m.text}`).join('\n') + '\n</memory-context>\n\n'
      : ''
    const combined = profileBlock + memBlock
    if (!combined) return { msgs: cleanMsgs, used: [], profileUsed: false }
    const out = cleanMsgs.slice()
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === 'user') {
        if (Array.isArray(out[i].content)) {
          out[i] = { ...out[i], content: [{ type: 'text', text: combined }, ...out[i].content] }
        } else {
          out[i] = { ...out[i], content: combined + out[i].content }
        }
        break
      }
    }
    return { msgs: out, used, profileUsed: !!profileBlock }
  }
}
