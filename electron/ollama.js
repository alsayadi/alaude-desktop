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

// ── In-app Ollama installer (macOS) ─────────────────────────────────────────
// Downloads the official Ollama.app zip from GitHub releases, extracts it,
// moves it to /Applications, and launches it. No browser trip. No separate
// installer. One confirmation, ~60s on a decent connection.
//
// Linux: downloads the static tarball, extracts `ollama` into ~/.alaude/bin/
// and spawns the daemon as a child process. Doesn't touch system dirs.
// Windows: not implemented yet — falls back to opening ollama.com.
//
// All progress is reported via `onProgress({phase, pct, message})`:
//   phase: 'download' | 'extract' | 'install' | 'launch' | 'waiting' | 'done' | 'error'
//   pct: 0-100 where meaningful, else null
//   message: human-readable status line
const fs = require('fs')
const _path = require('path')
const os = require('os')
const _childProcess = require('child_process')
const { spawn } = _childProcess

function _ghAssetUrl() {
  const plat = process.platform
  if (plat === 'darwin') return 'https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip'
  if (plat === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    return `https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${arch}.tgz`
  }
  return null
}

async function installOllama({ onProgress } = {}) {
  const report = (phase, pct, message) => { try { onProgress?.({ phase, pct, message }) } catch {} }
  const plat = process.platform
  const url = _ghAssetUrl()
  if (!url) {
    report('error', null, `Automated install not yet supported on ${plat}. Opening ollama.com…`)
    const { shell } = require('electron')
    shell.openExternal('https://ollama.com/download')
    return { installed: false, reason: 'unsupported-platform' }
  }

  const tmpDir = fs.mkdtempSync(_path.join(os.tmpdir(), 'alaude-ollama-'))
  const tmpArchive = _path.join(tmpDir, plat === 'darwin' ? 'Ollama.zip' : 'ollama.tgz')

  // ── 1. Download ─────────────────────────────────────────────────────────
  report('download', 0, 'Downloading Ollama…')
  await _downloadWithProgress(url, tmpArchive, (pct, done, total) => {
    const mb = (n) => (n / (1024 * 1024)).toFixed(0)
    report('download', pct, `Downloading Ollama… ${mb(done)} / ${mb(total)} MB`)
  })

  // ── 2. Extract ──────────────────────────────────────────────────────────
  report('extract', null, 'Extracting…')
  if (plat === 'darwin') {
    await _run('/usr/bin/unzip', ['-q', '-o', tmpArchive, '-d', tmpDir])
  } else {
    await _run('/usr/bin/tar', ['-xzf', tmpArchive, '-C', tmpDir])
  }

  // ── 3. Install ──────────────────────────────────────────────────────────
  if (plat === 'darwin') {
    // The zip contains Ollama.app at the top level.
    const extractedApp = _path.join(tmpDir, 'Ollama.app')
    if (!fs.existsSync(extractedApp)) {
      // Some releases nest it; scan for a .app
      const candidates = fs.readdirSync(tmpDir).filter(n => n.endsWith('.app'))
      if (!candidates.length) throw new Error('Ollama.app not found in archive')
      const found = _path.join(tmpDir, candidates[0])
      fs.renameSync(found, extractedApp)
    }
    const target = '/Applications/Ollama.app'
    report('install', null, 'Installing to /Applications…')
    // Try user-write first; if /Applications is read-only (rare), fall back to ~/Applications.
    try {
      // Remove any previous install (user may have had an outdated one)
      if (fs.existsSync(target)) {
        await _run('/bin/rm', ['-rf', target])
      }
      await _run('/bin/cp', ['-R', extractedApp, target])
      report('launch', null, 'Launching Ollama…')
      await _run('/usr/bin/open', ['-g', target]) // -g = don't steal focus
    } catch (err) {
      // Fallback: user-scoped install
      const userApps = _path.join(os.homedir(), 'Applications')
      fs.mkdirSync(userApps, { recursive: true })
      const userTarget = _path.join(userApps, 'Ollama.app')
      if (fs.existsSync(userTarget)) await _run('/bin/rm', ['-rf', userTarget])
      await _run('/bin/cp', ['-R', extractedApp, userTarget])
      await _run('/usr/bin/open', ['-g', userTarget])
    }
  } else {
    // Linux: place binary in ~/.alaude/bin/ollama and spawn daemon
    const binDir = _path.join(os.homedir(), '.alaude', 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    const extractedBin = _path.join(tmpDir, 'bin', 'ollama')
    const target = _path.join(binDir, 'ollama')
    await _run('/bin/cp', [extractedBin, target])
    fs.chmodSync(target, 0o755)
    report('launch', null, 'Starting Ollama daemon…')
    const child = spawn(target, ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
  }

  // ── 4. Wait for ready ───────────────────────────────────────────────────
  report('waiting', null, 'Waiting for Ollama to come online…')
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await isAvailable()) {
      report('done', 100, 'Ollama is ready.')
      // Best-effort cleanup of the temp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      return { installed: true }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Ollama installed but the daemon did not start within 30s. Try launching Ollama.app manually.')
}

function _downloadWithProgress(url, destPath, onPct) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const doReq = (u, redirectsLeft) => {
      const req = https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
          res.resume()
          return doReq(res.headers.location, redirectsLeft - 1)
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading Ollama`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        const out = fs.createWriteStream(destPath)
        let done = 0
        let lastEmit = 0
        res.on('data', (chunk) => {
          done += chunk.length
          const now = Date.now()
          if (total && now - lastEmit > 150) {
            onPct(Math.round((done / total) * 100), done, total)
            lastEmit = now
          }
        })
        res.on('error', reject)
        out.on('error', reject)
        out.on('finish', () => {
          onPct(100, done, total || done)
          resolve()
        })
        res.pipe(out)
      })
      req.on('error', reject)
    }
    doReq(url, 5)
  })
}

function _run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', d => { err += d.toString() })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${err.slice(0, 200)}`)))
  })
}

// v0.6.0: Semantic memory. Ollama's /api/embed lets us vectorize text
// locally, no cloud round-trip. Defaults to nomic-embed-text (274MB,
// 768-dim, great general-purpose). Caller can override the model.
//
// Accepts a single string or an array; always returns an array of
// number[] so the caller code is uniform.
async function embed(texts, model = 'nomic-embed-text') {
  const input = Array.isArray(texts) ? texts : [texts]
  if (!input.length) return []
  try {
    const res = await fetch(`${BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`ollama /api/embed failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const json = await res.json()
    return json.embeddings || []
  } catch (err) {
    // Re-throw with a more actionable message when the model isn't pulled.
    if (/not found/i.test(err.message)) {
      throw new Error(`Embedding model "${model}" isn't pulled. Run: ollama pull ${model}`)
    }
    throw err
  }
}

// Check whether ANY embedding-capable model is installed. Returns the
// first matching name or null if none. Used by the renderer to decide
// between semantic and keyword recall.
async function findEmbedModel() {
  const installed = await listInstalled()
  const names = installed.map(m => m.name)
  const preferred = [
    'nomic-embed-text', 'nomic-embed-text:latest',
    'all-minilm', 'all-minilm:latest',
    'mxbai-embed-large', 'mxbai-embed-large:latest',
    'bge-m3', 'bge-m3:latest',
  ]
  for (const p of preferred) if (names.includes(p)) return p
  // Fallback: any model with "embed" in its name.
  const fallback = names.find(n => /embed/i.test(n))
  return fallback || null
}

module.exports = { isAvailable, listInstalled, pull, remove, installOllama, embed, findEmbedModel, BASE }
