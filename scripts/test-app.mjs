#!/usr/bin/env node
// Labaik self-test — run after any refactor or risky change.
//
//   node scripts/test-app.mjs
//
// Runs four layers of automatic checks. Anything it can't cover from the
// command line gets printed as a manual checklist at the end for you to
// verify in the running app window.
//
// Layers:
//   1. Module correctness — MemoryStore, ProfileStore, Recall, etc.
//      against a fake localStorage + mock Ollama. ~50 assertions.
//   2. Bridge audit         — every inline onclick in index.html has a
//      matching window.* alias in bootstrap.js.
//   3. Data integrity       — ~/.alaude/skills.json + ~/.claude/alaude-
//      events.ndjson parse clean; LevelDB localStorage writable.
//   4. OODA diff            — compare pre-refactor vs post-refactor event
//      signals (success rate, latency, errors) to spot regressions.
//
// What this DOESN'T test (you still need eyes on the window):
//   - Visual rendering of modals, badges, chips
//   - Click responsiveness
//   - Toasts appearing + vanishing
//   - Shift-click modifiers behaving right
//   - Regressions in unrefactored features (skills modal, ollama install,
//     crew mode, sidebar resize)
//
// The manual checklist at the end covers those.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

let totalPass = 0, totalFail = 0

function section(title) { console.log('\n' + '═'.repeat(62) + '\n  ' + title + '\n' + '═'.repeat(62)) }
function check(label, cond, extra = '') {
  if (cond) { console.log('  ✅', label); totalPass++ }
  else { console.log('  ❌', label, extra); totalFail++ }
}

// ═══ Layer 1: module correctness (delegated to test-modules.mjs) ═══
section('Layer 1 · Module correctness')
try {
  const out = execSync(`node ${path.join(__dirname, 'test-modules.mjs')}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
  const m = out.match(/(\d+) passed, (\d+) failed/)
  if (m) {
    totalPass += parseInt(m[1])
    if (parseInt(m[2]) > 0) totalFail += parseInt(m[2])
    console.log(`  ${m[2] === '0' ? '✅' : '❌'}  Module tests: ${m[1]} passed, ${m[2]} failed`)
  } else {
    console.log('  ⚠️  Could not parse module test output')
  }
} catch (err) {
  console.log('  ❌ Module tests failed:', err.message)
  totalFail++
}

// ═══ Layer 2: bridge audit ═══
section('Layer 2 · Inline onclick → bootstrap bridge coverage')
{
  const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8')
  const boot = fs.readFileSync(path.join(ROOT, 'renderer/js/bootstrap.js'), 'utf8')
  const calls = new Set()
  for (const m of html.matchAll(/\bon(?:click|input|change)="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g)) calls.add(m[1])
  for (const m of html.matchAll(/onclick=(?:\\"|"|`)[^"`\\]*?\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) calls.add(m[1])
  const mem = [...calls].filter(n => /^(memory|profile|toggleMemory|renderMemory|renderProfile|installSemanticEmbedModel|reindexMemoryEmbeddings|setMemoryScopeFilter|setMemoryRecallMode|setMemoryIncognito)/.test(n)).sort()
  let missing = 0
  for (const fn of mem) {
    const re = new RegExp(`(?:win|window)\\.${fn}\\s*=`)
    if (!re.test(boot)) { console.log('  ❌ no bridge for:', fn); missing++; totalFail++ }
  }
  if (!missing) { console.log(`  ✅ All ${mem.length} memory/profile handlers have bridges`); totalPass++ }
}

// ═══ Layer 2b: v0.7.33 — overlay reset guard covers every known overlay ═══
section('Layer 2b · Boot-time overlay guard covers all overlay classes')
{
  const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8')
  const boot = fs.readFileSync(path.join(ROOT, 'renderer/js/bootstrap.js'), 'utf8')
  // Extract every CSS class ending in "-overlay" used in HTML or CSS in index.html.
  const classes = new Set()
  for (const m of html.matchAll(/class\s*=\s*"[^"]*?([a-zA-Z][a-zA-Z0-9_-]*-overlay)\b[^"]*"/g)) {
    classes.add(m[1])
  }
  for (const m of html.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*-overlay)\b/g)) {
    classes.add(m[1])
  }
  // Verify bootstrap's OVERLAY_SELECTOR covers them. Extract from the literal
  // array in bootstrap.js so the test tracks the actual code.
  const m = boot.match(/const\s+OVERLAY_SELECTOR\s*=\s*\[([\s\S]*?)\]\.join/)
  const bootClasses = new Set()
  if (m) {
    for (const s of m[1].matchAll(/'\.([a-zA-Z][a-zA-Z0-9_-]*-overlay)'/g)) {
      bootClasses.add(s[1])
    }
  }
  const missing = [...classes].filter(c => !bootClasses.has(c))
  if (missing.length) {
    console.log(`  ❌ Boot guard missing selectors: ${missing.join(', ')}`)
    totalFail++
  } else {
    console.log(`  ✅ All ${classes.size} overlay classes covered by boot guard`)
    totalPass++
  }
}

// ═══ Layer 3: data integrity ═══
section('Layer 3 · On-disk state integrity')
{
  // skills.json
  try {
    const data = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.alaude/skills.json'), 'utf8'))
    check('skills.json parses + has skills array',
      typeof data.version === 'number' && Array.isArray(data.skills))
    const bad = (data.skills || []).filter(s => !s.id || !s.name || !s.cron || !s.prompt).length
    check('all skills well-formed', bad === 0)
  } catch (err) {
    if (err.code === 'ENOENT') console.log('  ⚠️  skills.json not present (ok — no skills defined yet)')
    else { check('skills.json readable', false, err.message) }
  }
  // event log
  try {
    const lines = fs.readFileSync(path.join(os.homedir(), '.claude/alaude-events.ndjson'), 'utf8').split('\n').filter(Boolean)
    let bad = 0
    for (const l of lines) { try { JSON.parse(l) } catch { bad++ } }
    check(`event log parses (${lines.length} events, ${bad} malformed)`, bad === 0)
  } catch (err) {
    console.log('  ⚠️  no event log yet (ok — fresh install)')
  }
  // localStorage (best-effort — snappy compression, just check dir exists)
  const ldDir = path.join(os.homedir(), 'Library/Application Support/alaude-desktop/Local Storage/leveldb')
  try {
    const entries = fs.readdirSync(ldDir)
    check('Chromium LocalStorage leveldb present',
      entries.some(f => f.endsWith('.log')))
  } catch {
    console.log('  ⚠️  alaude-desktop LocalStorage not present (legacy Alaude dir may be in use)')
  }
}

// ═══ Layer 4: OODA signal diff (optional — needs event log) ═══
section('Layer 4 · Event signal diff (last 100 pre- vs all post-refactor)')
try {
  const events = fs.readFileSync(path.join(os.homedir(), '.claude/alaude-events.ndjson'), 'utf8')
    .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  // Cutoff: 1 hour before last mtime of bootstrap.js (proxy for refactor time)
  const bootMtime = fs.statSync(path.join(ROOT, 'renderer/js/bootstrap.js')).mtimeMs
  const cutoff = bootMtime - 60 * 60 * 1000
  const pre = events.filter(e => new Date(e.ts).getTime() < cutoff).slice(-100)
  const post = events.filter(e => new Date(e.ts).getTime() >= cutoff)
  if (pre.length < 10 || post.length < 3) {
    console.log(`  ⚠️  Not enough data for signal diff (pre=${pre.length}, post=${post.length})`)
  } else {
    function summary(evs) {
      const sends = evs.filter(e => e.kind === 'chat_send').length
      const errs = evs.filter(e => e.kind === 'chat_error' || (e.kind === 'chat_complete' && !e.success)).length
      const lats = evs.filter(e => e.kind === 'chat_complete' && typeof e.latencyMs === 'number').map(e => e.latencyMs).sort((a, b) => a - b)
      return {
        sends,
        errRate: sends ? errs / sends : 0,
        p50: lats[Math.floor(lats.length * 0.5)] || 0,
        p95: lats[Math.floor(lats.length * 0.95)] || 0,
      }
    }
    const a = summary(pre), b = summary(post)
    const errRateRegressed = b.errRate > a.errRate * 1.5 && b.errRate > 0.3
    const latencyRegressed = b.p95 > a.p95 * 1.5 && b.p95 > 30_000
    check(`error rate stable (${(a.errRate*100).toFixed(0)}% → ${(b.errRate*100).toFixed(0)}%)`, !errRateRegressed)
    check(`p95 latency stable (${(a.p95/1000).toFixed(1)}s → ${(b.p95/1000).toFixed(1)}s)`, !latencyRegressed)
  }
} catch (err) {
  console.log('  ⚠️  Signal diff skipped:', err.message)
}

// ═══ Final summary ═══
console.log('\n' + '═'.repeat(62))
console.log(`  RESULT: ${totalPass} automatic checks passed, ${totalFail} failed`)
console.log('═'.repeat(62))

// ═══ Manual checklist ═══
console.log(`
What this test cannot cover (verify in the app window):

  ┌──────────────────────────────────────────────────────────────┐
  │  Memory + Profile (v0.7.0 / v0.7.1 surfaces)                 │
  │   1. Open 🧠 Memory Lens → onboarding modal shows (once).    │
  │   2. Fill or skip → About You section appears at top.        │
  │   3. Type "I prefer Vue over React" → green promote chip.    │
  │      Click → fact lands in profile, chip disappears.         │
  │   4. "🧠 Remember" button on user msg → toast 📁 (workspace) │
  │      Shift-click same button → toast 🌐 (global)             │
  │   5. Switch workspace folder → memory tabs filter correctly. │
  │   6. 🕶️ Incognito toggle → profile injection stops silently. │
  │                                                              │
  │  Classic features (no-refactor regression canaries)          │
  │   7. ⏰ Skills modal opens, shows existing skills.           │
  │   8. Ollama model list loads, can install an embed model.    │
  │   9. Sidebar collapse/resize still works.                    │
  │  10. Crew mode (3 lanes) renders side-by-side.               │
  │  11. Cmd+K command palette opens, "Memory Lens" entry works. │
  │  12. Chat send works against at least one provider.          │
  └──────────────────────────────────────────────────────────────┘
`)

process.exit(totalFail > 0 ? 1 : 0)
