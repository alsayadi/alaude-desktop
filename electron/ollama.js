/**
 * Ollama HTTP client — runs in the Electron main process.
 *
 * Wraps http://localhost:11434 (Ollama's default bind).
 * - isAvailable(): fast probe, 1s timeout.
 * - listInstalled(): GET /api/tags.
 * - pull(model, onProgress): POST /api/pull with stream=true, NDJSON progress.
 * - remove(model): DELETE /api/delete.
 *
 * Uses Node 18+ built-in fetch + AbortController. No new dependency.
 * Chat does NOT go through here — it runs in api-worker.js via the OpenAI-compatible endpoint.
 */

const BASE = 'http://localhost:11434'

async function isAvailable() {
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 1000)
    const res = await fetch(`${BASE}/api/tags`, { signal: ctrl.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

async function listInstalled() {
  try {
    const res = await fetch(`${BASE}/api/tags`)
    if (!res.ok) return []
    const data = await res.json()
    // Normalise to { name, size, modified_at, family }
    return (data.models || []).map(m => ({
      name: m.name,
      size: m.size || 0,
      modified_at: m.modified_at,
      family: (m.details?.family) || (m.name.split(':')[0] || '').toLowerCase(),
    }))
  } catch (err) {
    console.error('[ollama] listInstalled failed:', err.message)
    return []
  }
}

/**
 * Pull a model with streaming progress.
 * Returns an object { promise, cancel } — caller awaits `promise`, or calls `cancel()` to abort.
 *
 * onProgress receives objects with shape:
 *   { status: string, completed?: number, total?: number, percent?: number, digest?: string }
 */
function pull(model, onProgress) {
  const ctrl = new AbortController()

  const promise = (async () => {
    const res = await fetch(`${BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`ollama pull failed (${res.status}): ${text.slice(0, 200)}`)
    }

    // NDJSON stream — each line is a JSON object
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let lastStatus = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line)
          const completed = obj.completed || 0
          const total = obj.total || 0
          const percent = total > 0 ? Math.round((completed / total) * 100) : null
          if (obj.status && obj.status !== lastStatus) lastStatus = obj.status
          onProgress?.({
            status: obj.status || lastStatus || 'working',
            completed,
            total,
            percent,
            digest: obj.digest,
            error: obj.error,
          })
          if (obj.error) throw new Error(obj.error)
        } catch (err) {
          if (err.name !== 'SyntaxError') throw err
          // ignore partial lines
        }
      }
    }

    onProgress?.({ status: 'success', completed: 0, total: 0, percent: 100 })
    return true
  })()

  return {
    promise,
    cancel: () => { try { ctrl.abort() } catch {} },
  }
}

async function remove(model) {
  const res = await fetch(`${BASE}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`ollama delete failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return true
}

module.exports = { isAvailable, listInstalled, pull, remove, BASE }
