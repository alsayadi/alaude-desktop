// fs-backed-storage.js — localStorage-compatible façade backed by the
// main-process filesystem (via the `alaude.fsJsonReadSync/WriteSync`
// bridge wired up in preload.js + main.js).
//
// WHY: Chromium's localStorage batches writes to LevelDB asynchronously.
// Between `setItem()` returning and the bytes hitting disk there's a
// window in which a SIGTERM or crash loses the write. For memory +
// profile entries — single-shot writes with no replay path — this showed
// up as "I added a memory yesterday, restart, it's gone."
//
// This adapter intercepts getItem/setItem/removeItem for a known set of
// keys and routes them through `ipcRenderer.sendSync` → main process →
// `writeFileSync` on `~/.alaude/{name}.json`. By the time setItem
// returns, the bytes are in the kernel page cache — durable across
// process kill.
//
// Design constraints:
//   - Drop-in replacement: MemoryStore and ProfileStore already accept a
//     `{ storage }` option expecting the localStorage interface. This
//     module returns exactly that.
//   - Safe fallback: if the bridge isn't available (quick-window dev
//     context, or an older preload), we return plain localStorage so
//     nothing breaks.
//   - Migration: on first getItem(), if fs is empty but localStorage
//     has existing data, we seed fs from localStorage. Users don't
//     lose what they already had.
//   - Belt & braces: every setItem also writes to localStorage. This
//     means if we ever need to revert, the old code path still works.
//     The fs copy just becomes the authoritative source.

/**
 * @typedef {Object} KeyMap
 * Maps each tracked localStorage key to a logical `name` for the fs store.
 * Multiple keys can share a name — e.g. memory uses one JSON file for its
 * entries and a second key for recall mode. We flatten the record into
 * { [fsName]: { entries: ..., recallMode: ... } } so all mini-keys for a
 * store land in one file.
 *
 * Shape:
 *   { 'alaude:memory:v1': { file: 'memory', field: 'entries' },
 *     'alaude:memory-recall-mode:v1': { file: 'memory', field: 'recallMode' } }
 */

function _getBridge() {
  const w = globalThis.window || globalThis
  const a = w.alaude
  if (!a) return null
  if (typeof a.fsJsonReadSync !== 'function') return null
  if (typeof a.fsJsonWriteSync !== 'function') return null
  return a
}

/**
 * Build a localStorage-compatible storage that persists through fs.
 *
 * @param {Record<string, { file: string, field: string }>} keyMap
 * @returns {Storage}
 */
export function createFsBackedStorage(keyMap) {
  const ls = globalThis.localStorage
  const bridge = _getBridge()

  // No bridge → plain localStorage. Dev paths (quick window) still work.
  if (!bridge) {
    console.warn('[fs-backed-storage] bridge unavailable — falling back to plain localStorage')
    return ls
  }

  // Group keys by fs file so we touch each file once per read/write batch.
  // One file holds all fields for a store. e.g. memory.json =
  //   { entries: '...', recallMode: '...' }
  // Field values are stored as the RAW string the caller passed to
  // setItem — we don't re-parse them. This matches localStorage's
  // "everything is a string" contract exactly, and is what MemoryStore
  // expects when it JSON.parses its value.

  // Warm cache: one read per file, not one per getItem(). We invalidate
  // on every setItem/removeItem that touches that file, so writes from
  // this process are never stale. Cross-process changes can't happen
  // (only main writes, and main only writes when this process asks it to).
  const cache = new Map() // fsName → parsed object (or null if missing)

  function _readFile(fsName) {
    if (cache.has(fsName)) return cache.get(fsName)
    const data = bridge.fsJsonReadSync(fsName)
    // Normalise: main returns null on missing/corrupt; keep that as-is.
    cache.set(fsName, data)
    return data
  }

  function _writeFile(fsName, obj) {
    bridge.fsJsonWriteSync(fsName, obj)
    cache.set(fsName, obj)
  }

  return {
    get length() { return ls.length },
    key(i) { return ls.key(i) },
    clear() {
      // Very rare. Just delegate to both — the file clears will happen
      // naturally as callers removeItem() each tracked key.
      try { ls.clear() } catch {}
      cache.clear()
    },
    getItem(key) {
      const m = keyMap[key]
      if (!m) return ls.getItem(key)
      const file = _readFile(m.file)
      if (file && Object.prototype.hasOwnProperty.call(file, m.field)) {
        const v = file[m.field]
        // Mirror to localStorage so legacy code paths (window.memories
        // getter, old onclick handlers) still see the latest value.
        try { if (v != null) ls.setItem(key, v) } catch {}
        return v == null ? null : String(v)
      }
      // Fs miss → migration path. If localStorage has the key, seed fs
      // with it so next boot doesn't fall through again.
      const legacy = ls.getItem(key)
      if (legacy != null) {
        const next = file && typeof file === 'object' ? { ...file } : {}
        next[m.field] = legacy
        try { _writeFile(m.file, next) } catch (err) {
          console.warn('[fs-backed-storage] migration write failed for', key, err)
        }
      }
      return legacy
    },
    setItem(key, value) {
      const m = keyMap[key]
      // Mirror to localStorage unconditionally — belt & braces.
      try { ls.setItem(key, value) } catch {}
      if (!m) return
      const file = _readFile(m.file)
      const next = file && typeof file === 'object' ? { ...file } : {}
      next[m.field] = value
      _writeFile(m.file, next)
    },
    removeItem(key) {
      try { ls.removeItem(key) } catch {}
      const m = keyMap[key]
      if (!m) return
      const file = _readFile(m.file)
      if (!file || typeof file !== 'object') return
      if (!(m.field in file)) return
      const next = { ...file }
      delete next[m.field]
      _writeFile(m.file, next)
    },
  }
}
