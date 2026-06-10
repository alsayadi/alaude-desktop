/**
 * Routines — cron-scheduled background chats.
 *
 * A "routine" is a prompt + cron spec that Labaik runs automatically on a
 * schedule. Examples:
 *   • 08:00 daily → "summarize overnight Hacker News"
 *   • 18:00 weekdays → "draft a standup update from my git log"
 *   • every 15 minutes → "ping the production status URL and alert if it changed"
 *
 * (Formerly "Cron Skills" — renamed so "Skills" can mean folder-based
 * SKILL.md skills, matching the wider agent ecosystem. See
 * docs/research/agent-landscape-2026.md and electron/folder-skills.js.)
 *
 * Runtime behaviour
 *   • Routines live in ~/.labaik/routines.json (migrated from the old
 *     skills.json on first load).
 *   • A polling scheduler wakes once a minute and fires any due routine via
 *     the chat IPC.
 *   • Fires are serialised to avoid hammering the provider — one routine at
 *     a time. A routine that takes 2 min just pushes out the next one.
 *
 * Why in-process and not a cron daemon: the user's machine must be awake
 * for a routine to run, and we want provider creds + memory + workspace
 * context available. Simpler than shelling to `cron`.
 */

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const ROUTINES_FILE = paths.resolveWithMigration(
  path.join(paths.BASE_DIR, 'routines.json'),
  [path.join(paths.BASE_DIR, 'skills.json'),
   path.join(paths.LEGACY_ALAUDE_DIR, 'skills.json')]
)
const HISTORY_FILE = paths.resolveWithMigration(
  path.join(paths.BASE_DIR, 'routine-history.ndjson'),
  [path.join(paths.BASE_DIR, 'skill-history.ndjson')]
)

function _load() {
  try {
    if (!fs.existsSync(ROUTINES_FILE)) return { version: 1, routines: [] }
    const data = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf8'))
    // Accept the pre-rename shape ({ skills: [...] }) so a migrated
    // skills.json keeps working without a separate rewrite step.
    if (!Array.isArray(data.routines)) data.routines = Array.isArray(data.skills) ? data.skills : []
    delete data.skills
    return data
  } catch { return { version: 1, routines: [] } }
}

function _save(state) {
  try {
    fs.mkdirSync(path.dirname(ROUTINES_FILE), { recursive: true })
    fs.writeFileSync(ROUTINES_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[routines] save failed:', err.message)
  }
}

function list() { return _load().routines }

function upsert(routine) {
  const state = _load()
  const id = routine.id || ('rt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6))
  const now = Date.now()
  const existing = state.routines.find(s => s.id === id)
  const merged = {
    id,
    name: String(routine.name || 'Untitled routine').slice(0, 100),
    prompt: String(routine.prompt || ''),
    model: routine.model || '',
    cron: String(routine.cron || ''),  // e.g. "0 8 * * *" or "*/15 * * * *"
    enabled: routine.enabled !== false,
    notify: routine.notify !== false,  // v0.8 cycle 24: per-routine desktop notifications
    // v0.8 cycle 24 — watcher: when set, the routine only proceeds (and
    // notifies) if this page's text actually changed since last check.
    // Passing watch explicitly (even empty) overwrites; omitting keeps.
    watch: routine.watch !== undefined
      ? ((routine.watch && routine.watch.url) ? { url: String(routine.watch.url).slice(0, 500) } : null)
      : (existing?.watch || null),
    lastRunAt: existing?.lastRunAt || null,
    lastStatus: existing?.lastStatus || null,
    lastResult: existing?.lastResult || null,
    nextFireAt: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  // Recompute nextFireAt on every save
  merged.nextFireAt = _nextFire(merged.cron, now)
  const idx = state.routines.findIndex(s => s.id === id)
  if (idx >= 0) state.routines[idx] = merged
  else state.routines.push(merged)
  _save(state)
  return merged
}

function remove(id) {
  const state = _load()
  state.routines = state.routines.filter(s => s.id !== id)
  _save(state)
}

function setEnabled(id, enabled) {
  const state = _load()
  const s = state.routines.find(s => s.id === id)
  if (!s) return false
  s.enabled = !!enabled
  s.updatedAt = Date.now()
  s.nextFireAt = enabled ? _nextFire(s.cron, Date.now()) : null
  _save(state)
  return true
}

function recordRun(id, { status, resultPreview }) {
  const state = _load()
  const s = state.routines.find(x => x.id === id)
  if (!s) return
  s.lastRunAt = Date.now()
  s.lastStatus = status
  s.lastResult = (resultPreview || '').slice(0, 400)
  s.nextFireAt = _nextFire(s.cron, Date.now() + 60000) // push past current minute
  _save(state)
  // Also append to history log for future scrollback
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true })
    fs.appendFileSync(HISTORY_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      id: s.id,
      name: s.name,
      status,
      resultPreview: (resultPreview || '').slice(0, 400),
    }) + '\n')
  } catch {}
}

/**
 * Recent run history — newest first. Reads the tail of the ndjson log so a
 * year of runs doesn't get parsed for a 30-row view.
 */
function history(limit = 30) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return []
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8')
    const lines = raw.split('\n').filter(Boolean).slice(-limit)
    const out = []
    for (const l of lines) { try { out.push(JSON.parse(l)) } catch {} }
    return out.reverse()
  } catch { return [] }
}

// ── Tiny cron parser ───────────────────────────────────────────────────────
// Supports standard 5-field format (min hour dom mon dow) with:
//   • literal numbers
//   • '*' (any)
//   • '*/N' (every N units)
//   • 'a,b,c' lists
//   • 'a-b' ranges
// Cron is in the USER'S local timezone (matches mental model).
function _parseField(expr, min, max) {
  const parts = String(expr).split(',')
  const values = new Set()
  for (const part of parts) {
    const [rangeExpr, stepStr] = part.split('/')
    const step = stepStr ? parseInt(stepStr, 10) : 1
    let from = min, to = max
    if (rangeExpr !== '*') {
      if (rangeExpr.includes('-')) {
        const [a, b] = rangeExpr.split('-').map(n => parseInt(n, 10))
        from = a; to = b
      } else {
        from = to = parseInt(rangeExpr, 10)
      }
    }
    if (isNaN(from) || isNaN(to)) return null
    for (let v = from; v <= to; v += step) {
      if (v >= min && v <= max) values.add(v)
    }
  }
  return values
}

function _parseCron(expr) {
  if (!expr || typeof expr !== 'string') return null
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const min = _parseField(fields[0], 0, 59)
  const hour = _parseField(fields[1], 0, 23)
  const dom = _parseField(fields[2], 1, 31)
  const mon = _parseField(fields[3], 1, 12)
  const dow = _parseField(fields[4], 0, 6) // 0 = Sunday
  if (!min || !hour || !dom || !mon || !dow) return null
  return { min, hour, dom, mon, dow }
}

function _matchesNow(parsed, d) {
  if (!parsed) return false
  return parsed.min.has(d.getMinutes())
    && parsed.hour.has(d.getHours())
    && parsed.mon.has(d.getMonth() + 1)
    && (parsed.dom.has(d.getDate()) || parsed.dow.has(d.getDay()))
}

function _nextFire(expr, fromTs) {
  const parsed = _parseCron(expr)
  if (!parsed) return null
  const d = new Date(fromTs)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1) // start searching from next minute
  // Give up after a year — pathological cron spec.
  const deadline = fromTs + 365 * 24 * 60 * 60 * 1000
  while (d.getTime() < deadline) {
    if (_matchesNow(parsed, d)) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

// v0.8 cycle 21 — most recent fire time at or before fromTs, within the
// window. Minute-by-minute backwards scan: 7 days = 10,080 cheap set
// lookups, ~1ms. Used for catch-up runs.
const CATCHUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
function _prevFire(expr, fromTs, windowMs = CATCHUP_WINDOW_MS) {
  const parsed = _parseCron(expr)
  if (!parsed) return null
  const d = new Date(fromTs)
  d.setSeconds(0, 0)
  const floor = fromTs - windowMs
  while (d.getTime() >= floor) {
    if (_matchesNow(parsed, d)) return d.getTime()
    d.setMinutes(d.getMinutes() - 1)
  }
  return null
}

/**
 * v0.8 cycle 21 — catch-up semantics (the Claude Desktop pattern, and the
 * fix for scheduled-task tools' #1 complaint: silent non-firing). If the
 * machine was asleep or the app closed when a routine should have fired,
 * run EXACTLY ONE catch-up for the most recent missed occurrence within
 * a 7-day window. Guarded by createdAt so a routine created after today's
 * slot doesn't retro-fire, and by lastRunAt so each miss is made up once.
 * Returns the missed fire's timestamp, or null when nothing is owed.
 */
function _catchUpDue(s, nowMs, windowMs = CATCHUP_WINDOW_MS) {
  if (!s || !s.enabled) return null
  const prev = _prevFire(s.cron, nowMs - 60000, windowMs) // exclude current minute (normal tick owns it)
  if (!prev) return null
  const baseline = Math.max(s.lastRunAt || 0, s.createdAt || 0)
  return prev > baseline ? prev : null
}

// ── Scheduler ──────────────────────────────────────────────────────────────
let _pollTimer = null
let _running = false
function startScheduler(onFire) {
  if (_pollTimer) return
  const tick = async () => {
    const state = _load()
    const now = Date.now()
    const currentMinute = new Date(now)
    currentMinute.setSeconds(0, 0)
    for (const s of state.routines) {
      if (!s.enabled) continue
      const parsed = _parseCron(s.cron)
      let catchUp = false
      if (!_matchesNow(parsed, currentMinute)) {
        // v0.8 cycle 21 — missed while asleep/closed? Make up exactly one.
        if (!_catchUpDue(s, currentMinute.getTime())) continue
        catchUp = true
      }
      // Skip if we already ran THIS minute.
      if (s.lastRunAt && Math.floor(s.lastRunAt / 60000) === Math.floor(currentMinute.getTime() / 60000)) continue
      if (_running) continue // serialise
      _running = true
      try {
        await onFire(s, { catchUp })
      } catch (err) {
        console.error('[routines] fire failed:', err.message)
        recordRun(s.id, { status: 'error', resultPreview: String(err.message).slice(0, 400) })
      } finally {
        _running = false
      }
    }
  }
  // Poll every 30s (twice per minute) to minimise drift.
  _pollTimer = setInterval(() => { tick().catch(() => {}) }, 30000)
  // Also do an immediate tick so a routine defined to run "every minute" fires
  // right after app boot rather than waiting for the first interval.
  setTimeout(() => tick().catch(() => {}), 2000)
}
function stopScheduler() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
}

module.exports = {
  list, upsert, remove, setEnabled, recordRun, history,
  startScheduler, stopScheduler,
  _parseCron, _nextFire, _prevFire, _catchUpDue,  // exposed for tests
}
