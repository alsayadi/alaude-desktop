/**
 * Cron Skills — scheduled background chats.
 *
 * A "skill" is a prompt + cron spec that Labaik runs automatically on a
 * schedule. Examples:
 *   • 08:00 daily → "summarize overnight Hacker News"
 *   • 18:00 weekdays → "draft a standup update from my git log"
 *   • every 15 minutes → "ping the production status URL and alert if it changed"
 *
 * Runtime behaviour
 *   • Skills live in ~/.alaude/skills.json.
 *   • A polling scheduler wakes once a minute and fires any due skill via
 *     the chat IPC. Results stream into a dedicated "Skills" session so the
 *     user can scroll back through automated runs.
 *   • Fires are serialised to avoid hammering the provider — one skill at a
 *     time. A skill that takes 2 min just pushes out the next one.
 *
 * Why in-process and not a cron daemon: the user's machine must be awake
 * for a skill to run, and we want provider creds + memory + workspace
 * context available. Simpler than shelling to `cron`.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const SKILLS_FILE = path.join(os.homedir(), '.alaude', 'skills.json')
const HISTORY_FILE = path.join(os.homedir(), '.alaude', 'skill-history.ndjson')

function _load() {
  try {
    if (!fs.existsSync(SKILLS_FILE)) return { version: 1, skills: [] }
    const data = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'))
    if (!Array.isArray(data.skills)) data.skills = []
    return data
  } catch { return { version: 1, skills: [] } }
}

function _save(state) {
  try {
    fs.mkdirSync(path.dirname(SKILLS_FILE), { recursive: true })
    fs.writeFileSync(SKILLS_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[skills] save failed:', err.message)
  }
}

function list() { return _load().skills }

function upsert(skill) {
  const state = _load()
  const id = skill.id || ('sk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6))
  const now = Date.now()
  const existing = state.skills.find(s => s.id === id)
  const merged = {
    id,
    name: String(skill.name || 'Untitled skill').slice(0, 100),
    prompt: String(skill.prompt || ''),
    model: skill.model || '',
    cron: String(skill.cron || ''),  // e.g. "0 8 * * *" or "*/15 * * * *"
    enabled: skill.enabled !== false,
    lastRunAt: existing?.lastRunAt || null,
    lastStatus: existing?.lastStatus || null,
    lastResult: existing?.lastResult || null,
    nextFireAt: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  // Recompute nextFireAt on every save
  merged.nextFireAt = _nextFire(merged.cron, now)
  const idx = state.skills.findIndex(s => s.id === id)
  if (idx >= 0) state.skills[idx] = merged
  else state.skills.push(merged)
  _save(state)
  return merged
}

function remove(id) {
  const state = _load()
  state.skills = state.skills.filter(s => s.id !== id)
  _save(state)
}

function setEnabled(id, enabled) {
  const state = _load()
  const s = state.skills.find(s => s.id === id)
  if (!s) return false
  s.enabled = !!enabled
  s.updatedAt = Date.now()
  s.nextFireAt = enabled ? _nextFire(s.cron, Date.now()) : null
  _save(state)
  return true
}

function recordRun(id, { status, resultPreview }) {
  const state = _load()
  const s = state.skills.find(x => x.id === id)
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
    for (const s of state.skills) {
      if (!s.enabled) continue
      const parsed = _parseCron(s.cron)
      if (!_matchesNow(parsed, currentMinute)) continue
      // Skip if we already ran THIS minute.
      if (s.lastRunAt && Math.floor(s.lastRunAt / 60000) === Math.floor(currentMinute.getTime() / 60000)) continue
      if (_running) continue // serialise
      _running = true
      try {
        await onFire(s)
      } catch (err) {
        console.error('[skills] fire failed:', err.message)
        recordRun(s.id, { status: 'error', resultPreview: String(err.message).slice(0, 400) })
      } finally {
        _running = false
      }
    }
  }
  // Poll every 30s (twice per minute) to minimise drift.
  _pollTimer = setInterval(() => { tick().catch(() => {}) }, 30000)
  // Also do an immediate tick so a skill defined to run "every minute" fires
  // right after app boot rather than waiting for the first interval.
  setTimeout(() => tick().catch(() => {}), 2000)
}
function stopScheduler() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null }
}

module.exports = {
  list, upsert, remove, setEnabled, recordRun,
  startScheduler, stopScheduler,
  _parseCron, _nextFire,  // exposed for tests
}
