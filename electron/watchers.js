/**
 * watchers — "watch this page, tell me only when it changes" (cycle 24).
 *
 * A watcher is a routine with a `watch.url`. On each scheduled fire the
 * page is fetched and reduced to text; if the text hash matches the
 * stored snapshot the run ends quietly ("no change" in history, NO
 * notification). Only a real change runs the routine's prompt — with
 * before/after excerpts injected — and notifies. Notify-on-change-only
 * is the entire point: proactivity that pings daily with nothing reads
 * as spam (the Pulse/feed-creep lesson).
 *
 * Snapshots: ~/.labaik/watch-snapshots/<routineId>.json
 *   { hash, head, ts }   — head is a 600-char excerpt for the "before"
 *                          side of the change message.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { BASE_DIR, ensureBaseDir } = require('./paths')

const DIR = path.join(BASE_DIR, 'watch-snapshots')

function safeId(id) {
  return String(id || 'watch').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
}

/** Reduce an HTML page to comparable text: no scripts/styles/tags, collapsed
 *  whitespace, capped. Pure — unit-tested. */
function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200000)
}

/**
 * Compare `text` against the stored snapshot for `id` and update it.
 * Returns:
 *   { first: true }                         — baseline saved, no verdict yet
 *   { changed: false }                      — same as last time
 *   { changed: true, prevHead, prevTs }     — page changed
 */
function checkChange(id, text) {
  ensureBaseDir()
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const file = path.join(DIR, safeId(id) + '.json')
  const hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  let prev = null
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  const next = { hash, head: text.slice(0, 600), ts: Date.now() }
  if (!prev) {
    fs.writeFileSync(file, JSON.stringify(next))
    return { first: true, changed: false }
  }
  if (prev.hash === hash) return { first: false, changed: false }
  fs.writeFileSync(file, JSON.stringify(next))
  return { first: false, changed: true, prevHead: prev.head, prevTs: prev.ts }
}

/** Drop the snapshot (watcher deleted / test cleanup). */
function reset(id) {
  try { fs.rmSync(path.join(DIR, safeId(id) + '.json'), { force: true }) } catch {}
}

module.exports = { pageText, checkChange, reset, DIR }
