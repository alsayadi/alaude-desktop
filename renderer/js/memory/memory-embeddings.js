// MemoryEmbeddings — Ollama bridge + cosine similarity + backfill loop.
//
// Depends on window.alaude.{ollamaEmbed, ollamaFindEmbedModel, ollamaAvailable,
// ollamaPull} from preload.js. No direct UI, no direct storage — it writes
// embeddings into the injected MemoryStore via setEmbedding / setEmbeddingsBatch.

export class MemoryEmbeddings {
  constructor({ store, api = globalThis.alaude } = {}) {
    this.store = store
    this.api = api
    this._modelCached = undefined    // undefined = not checked, null = none, string = found
    this._backfilling = false
  }

  // Detect an installed embed model once and cache. Preference order
  // (matches electron/ollama.js findEmbedModel):
  //   all-minilm (45 MB) → nomic-embed-text → mxbai-embed-large → bge-m3
  async detectModel() {
    if (this._modelCached !== undefined) return this._modelCached
    try {
      this._modelCached = (await this.api?.ollamaFindEmbedModel?.()) || null
    } catch { this._modelCached = null }
    return this._modelCached
  }
  // Called after a successful pull to force re-detection.
  invalidateModel() { this._modelCached = undefined }

  // ── math ──────────────────────────────────────────────────────
  static cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    if (na === 0 || nb === 0) return 0
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  // ── embed calls ───────────────────────────────────────────────
  async embedOne(text) {
    try {
      const res = await this.api?.ollamaEmbed?.([String(text || '')])
      if (res?.ok && Array.isArray(res.embeddings) && res.embeddings[0]) return res.embeddings[0]
    } catch {}
    return null
  }
  async embedBatch(texts) {
    try {
      const res = await this.api?.ollamaEmbed?.(texts.map(t => String(t || '')))
      if (res?.ok && Array.isArray(res.embeddings)) {
        return { ok: true, vectors: res.embeddings, model: res.model }
      }
      return { ok: false, reason: res?.reason || 'unknown' }
    } catch (err) {
      return { ok: false, reason: 'error', error: err?.message }
    }
  }

  // ── backfill ──────────────────────────────────────────────────
  // Run in the background after each add() (one-off) and when the user
  // clicks Re-index (force=true). Batches of 32 match Ollama's /api/embed
  // soft limit.
  async ensureForEntry(entry) {
    if (!entry) return false
    const model = await this.detectModel()
    if (!model) return false
    const vec = await this.embedOne(entry.text)
    if (!vec) return false
    this.store.setEmbedding(entry.id, vec, model)
    return true
  }

  async ensureAll({ force = false, onProgress } = {}) {
    if (this._backfilling) return { started: false, reason: 'already-running' }
    const model = await this.detectModel()
    if (!model) return { started: false, reason: 'no-model' }
    const todo = this.store.pendingEmbed(force)
    if (!todo.length) return { started: false, reason: 'all-indexed', model }
    this._backfilling = true
    try {
      const CHUNK = 32
      for (let i = 0; i < todo.length; i += CHUNK) {
        const batch = todo.slice(i, i + CHUNK)
        const res = await this.embedBatch(batch.map(m => m.text))
        if (!res.ok) break
        const pairs = batch.map((m, j) => ({ id: m.id, vector: res.vectors[j], model: res.model }))
        this.store.setEmbeddingsBatch(pairs)
        if (onProgress) onProgress({ done: i + batch.length, total: todo.length })
      }
      return { started: true, done: todo.length, model }
    } finally {
      this._backfilling = false
    }
  }

  // ── one-click install flow ────────────────────────────────────
  // Returns { ok, reason? } — callers handle toast / UI refresh.
  async installDefaultModel({ onProgressText } = {}) {
    if (!(await this.api?.ollamaAvailable?.())) return { ok: false, reason: 'ollama-down' }
    try {
      if (onProgressText) onProgressText('Downloading all-minilm (~45 MB)…')
      await this.api?.ollamaPull?.('all-minilm')
      this.invalidateModel()
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: 'install-failed', error: String(err?.message || err) }
    }
  }
}
