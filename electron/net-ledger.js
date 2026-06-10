/**
 * net-ledger — a visible, local record of every outbound network call.
 *
 * WHY: "no backend, no telemetry" is a claim; this makes it something a
 * person can SEE. The "Your data" panel renders the last N entries —
 * which host, why, when — so "where does my stuff go?" has a concrete,
 * inspectable answer. The ledger itself never leaves the machine
 * (~/.labaik/net-ledger.ndjson) and is excluded from nothing — the user
 * can open the raw file.
 *
 * Covered call sites (the ones that carry user content):
 *   worker — chat requests (every provider), web_search, fetch_page
 *   main   — voice transcription, Ollama installer download
 * Local calls (Ollama on localhost) are logged with host 'localhost'
 * so the panel can show "stayed on this Mac" explicitly.
 *
 * Both processes append single JSON lines; appendFileSync of one short
 * line is effectively atomic, so cross-process interleaving is safe.
 */

const fs = require('fs')
const path = require('path')
const { BASE_DIR, ensureBaseDir } = require('./paths')

const FILE = path.join(BASE_DIR, 'net-ledger.ndjson')
const MAX_BYTES = 2 * 1024 * 1024 // rotate: keep newest half past 2MB

function log(host, why, detail) {
  try {
    ensureBaseDir()
    const entry = {
      ts: Date.now(),
      host: String(host || 'unknown').slice(0, 120),
      why: String(why || '').slice(0, 80),
      ...(detail ? { detail: String(detail).slice(0, 120) } : {}),
    }
    fs.appendFileSync(FILE, JSON.stringify(entry) + '\n')
    rotate()
  } catch {}
}

function rotate() {
  try {
    if (fs.statSync(FILE).size <= MAX_BYTES) return
    const lines = fs.readFileSync(FILE, 'utf8').split('\n')
    fs.writeFileSync(FILE, lines.slice(Math.floor(lines.length / 2)).join('\n'))
  } catch {}
}

/** Newest-first last `n` entries. */
function recent(n = 50) {
  try {
    const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n')
    return lines.slice(-n)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
      .reverse()
  } catch {
    return []
  }
}

function clear() {
  try { fs.rmSync(FILE, { force: true }) } catch {}
}

function hostOf(url) {
  try { return new URL(url).host } catch { return 'unknown' }
}

module.exports = { log, recent, clear, hostOf, FILE }
