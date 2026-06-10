/**
 * undo-snapshots — pre-images of files the agent mutates, grouped by
 * chat turn, so "undo what the agent just did" is one call.
 *
 * WHY: approval dialogs alone don't protect anyone — the user says yes
 * to a plausible-looking write and only later discovers what it really
 * did (the Cowork "11GB deletion" class of incident). Reversibility is
 * the trust unlock: every agent file mutation gets a pre-image FIRST,
 * so any turn can be rolled back byte-identically.
 *
 * LAYOUT  ~/.labaik/undo/<turnId>/
 *   manifest.json — { turnId, startedAt, entries: [{ file, existed,
 *                     snap, bytes, skipped? }] }
 *   <n>.bin       — pre-image body for entries[n] (only when existed)
 *   redo-<n>.bin  — state captured at restore time, so an undo can be
 *                   manually recovered from disk if it was a mistake.
 *
 * RULES
 *   • record() is called BEFORE the mutation. Only the FIRST pre-image
 *     per file per turn is kept — later writes in the same turn would
 *     otherwise overwrite the true "before" state.
 *   • Files larger than MAX_SNAP_BYTES are noted but not snapshotted
 *     (entry.skipped = true) — we never silently halve a write's speed
 *     on a 2GB artifact; the UI can say "too large to undo".
 *   • restoreTurn() puts every entry back: existed → rewrite pre-image;
 *     didn't exist → delete the file the agent created.
 *   • prune() keeps the last MAX_TURNS turns within MAX_AGE_DAYS.
 */

const fs = require('fs')
const path = require('path')
const { BASE_DIR, ensureBaseDir } = require('./paths')

const UNDO_DIR = path.join(BASE_DIR, 'undo')
const MAX_SNAP_BYTES = 10 * 1024 * 1024 // 10MB per file
const MAX_TURNS = 20
const MAX_AGE_DAYS = 7

// turnIds come from the chat request id; sanitize so a hostile value can
// never traverse out of UNDO_DIR.
function safeTurnId(turnId) {
  const s = String(turnId ?? 'turn').replace(/[^A-Za-z0-9_-]/g, '_')
  return s.slice(0, 80) || 'turn'
}

function turnDir(turnId) {
  return path.join(UNDO_DIR, safeTurnId(turnId))
}

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) } catch { return null }
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

/**
 * Snapshot `absPath` into the turn's undo dir. Call BEFORE mutating.
 * Returns the manifest entry (or null when recording failed — callers
 * must never let snapshot failure block the actual write).
 */
function record(turnId, absPath) {
  try {
    ensureBaseDir()
    const dir = turnDir(turnId)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const manifest = readManifest(dir) || { turnId: safeTurnId(turnId), startedAt: Date.now(), entries: [] }

    const file = path.resolve(absPath)
    if (manifest.entries.some(e => e.file === file)) return null // first pre-image wins

    const entry = { file, existed: false, snap: null, bytes: 0 }
    if (fs.existsSync(file)) {
      const st = fs.statSync(file)
      entry.existed = true
      entry.bytes = st.size
      if (st.size <= MAX_SNAP_BYTES && st.isFile()) {
        const snapName = manifest.entries.length + '.bin'
        fs.copyFileSync(file, path.join(dir, snapName))
        entry.snap = snapName
      } else {
        entry.skipped = true
      }
    }
    manifest.entries.push(entry)
    writeManifest(dir, manifest)
    prune()
    return entry
  } catch {
    return null
  }
}

/**
 * Roll back every mutation recorded for a turn. Current state is saved
 * as redo-<n>.bin first, so an accidental undo is itself recoverable.
 * Returns { restored, deleted, skipped, errors } — arrays of file paths.
 */
function restoreTurn(turnId) {
  const dir = turnDir(turnId)
  const manifest = readManifest(dir)
  if (!manifest) return { error: 'No undo data for this turn', restored: [], deleted: [], skipped: [], errors: [] }
  const out = { restored: [], deleted: [], skipped: [], errors: [] }
  manifest.entries.forEach((entry, i) => {
    try {
      // Capture what's there NOW before touching it.
      try {
        if (fs.existsSync(entry.file) && fs.statSync(entry.file).size <= MAX_SNAP_BYTES) {
          fs.copyFileSync(entry.file, path.join(dir, 'redo-' + i + '.bin'))
        }
      } catch {}
      if (entry.existed) {
        if (!entry.snap) { out.skipped.push(entry.file); return } // too large to snapshot
        fs.mkdirSync(path.dirname(entry.file), { recursive: true })
        fs.copyFileSync(path.join(dir, entry.snap), entry.file)
        out.restored.push(entry.file)
      } else {
        // Agent created it — undo means delete it.
        if (fs.existsSync(entry.file)) fs.unlinkSync(entry.file)
        out.deleted.push(entry.file)
      }
    } catch (err) {
      out.errors.push(entry.file + ': ' + err.message)
    }
  })
  return out
}

/** Newest-first summaries for the upcoming undo UI. */
function listTurns() {
  try {
    if (!fs.existsSync(UNDO_DIR)) return []
    return fs.readdirSync(UNDO_DIR)
      .map(name => readManifest(path.join(UNDO_DIR, name)))
      .filter(Boolean)
      .map(m => ({ turnId: m.turnId, at: m.startedAt, files: m.entries.length }))
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

function prune({ maxTurns = MAX_TURNS, maxAgeDays = MAX_AGE_DAYS } = {}) {
  try {
    if (!fs.existsSync(UNDO_DIR)) return
    const turns = fs.readdirSync(UNDO_DIR)
      .map(name => ({ name, manifest: readManifest(path.join(UNDO_DIR, name)) }))
      .filter(t => t.manifest)
      .sort((a, b) => b.manifest.startedAt - a.manifest.startedAt)
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    turns.forEach((t, idx) => {
      if (idx >= maxTurns || t.manifest.startedAt < cutoff) {
        fs.rmSync(path.join(UNDO_DIR, t.name), { recursive: true, force: true })
      }
    })
  } catch {}
}

module.exports = { record, restoreTurn, listTurns, prune, UNDO_DIR, MAX_SNAP_BYTES }
