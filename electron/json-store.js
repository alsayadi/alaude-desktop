/**
 * json-store — durable JSON persistence for the renderer.
 *
 * WHY THIS EXISTS
 *   Chromium's localStorage is backed by LevelDB with snappy compression.
 *   Writes are batched and flushed asynchronously — there's a window where
 *   `localStorage.setItem()` has "returned" but the bytes haven't hit disk.
 *   If Electron dies in that window (SIGTERM, crash, forced quit), the most
 *   recent writes are silently lost. Memory entries and profile facts being
 *   single-shot writes, this hit users who added a memory then relaunched.
 *
 *   Filesystem writeFileSync in the main process doesn't have this window —
 *   by the time the call returns, the bytes are in the kernel's page cache
 *   and will survive a process kill (an OS crash could still lose them, but
 *   that's a different category of failure).
 *
 * API
 *   read(name)       → parsed JSON or null if missing/corrupt
 *   write(name, obj) → true on success, false otherwise (never throws)
 *
 * SAFETY
 *   Writes go to `{path}.tmp` then `rename()` over the real file, so a kill
 *   in the middle of a write can never leave a half-written / corrupt file.
 *
 * NAMING
 *   `name` is a short logical key like 'memory' / 'profile' / 'sessions'.
 *   Resolves to `~/.alaude/{name}.json`. Strictly alphanumeric + dashes —
 *   path-traversal characters are rejected so renderer can't escape the
 *   alaude data directory.
 */

const fs = require('fs')
const path = require('path')
const { BASE_DIR, LEGACY_ALAUDE_DIR, ensureBaseDir } = require('./paths')

// Writes land in ~/.labaik/. Reads check ~/.labaik/ first, and fall back
// to ~/.alaude/ (v0.7.59–v0.7.63 legacy home) when the new file hasn't
// been created yet — a silent one-time migration on first write.
const SAFE_NAME = /^[a-z][a-z0-9_-]{0,63}$/i

function _resolve(name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) {
    throw new Error('json-store: invalid name ' + JSON.stringify(name))
  }
  return path.join(BASE_DIR, name + '.json')
}

function _legacyPath(name) {
  return path.join(LEGACY_ALAUDE_DIR, name + '.json')
}

function read(name) {
  try {
    const file = _resolve(name)
    // Fast path — canonical ~/.labaik/ location exists.
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8')
      return raw ? JSON.parse(raw) : null
    }
    // Migration path — fall back to ~/.alaude/ if present. Don't copy
    // here; the next write() will land in the new location and subsequent
    // reads will hit the fast path. This keeps the read path zero-disk-write
    // (important: boot-time reads happen concurrently and a copy storm
    // would be a footgun).
    const legacy = _legacyPath(name)
    if (fs.existsSync(legacy)) {
      const raw = fs.readFileSync(legacy, 'utf8')
      return raw ? JSON.parse(raw) : null
    }
    return null
  } catch (err) {
    console.warn('[json-store] read(' + name + ') failed:', err.message)
    return null
  }
}

function write(name, obj) {
  try {
    const file = _resolve(name)
    ensureBaseDir()
    const tmp = file + '.tmp'
    // pretty-printed on purpose — these files are small and users sometimes
    // grep/inspect them. A few extra bytes is cheap for debuggability.
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    console.warn('[json-store] write(' + name + ') failed:', err.message)
    return false
  }
}

module.exports = { read, write }
