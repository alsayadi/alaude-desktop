// Boot smoke test — launches the REAL Electron app hermetically and waits
// for the boot beacon ("[boot] main script completed ✓") that is the last
// statement of renderer/index.html's main inline script.
//
// Exists because two boot-crash regressions (a TDZ call and an infinite
// recursion) sailed past 88 unit checks: nothing executed the renderer's
// main script. If any statement in it throws, the beacon never fires and
// this test fails in ~3 seconds instead of a user finding the app stuck
// on the login page.
//
// Hermetic: LABAIK_HOME and LABAIK_USERDATA point at temp dirs, so the
// test instance never touches real state and never fights a running app
// over the LevelDB lock. A brief app window flashes during the run —
// that's the real app booting; it's killed as soon as the beacon lands.
//
// Run: npm run test:boot   (part of npm test)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = 30000
const BEACON = '[boot] main script completed'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-boot-home-'))
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-boot-ud-'))

const electronBin = path.join(ROOT, 'node_modules', '.bin', 'electron')
if (!fs.existsSync(electronBin)) {
  console.log('⚠️  electron binary not found — skipping boot smoke test')
  process.exit(0)
}

console.log('Boot smoke test — launching the real app (a window will flash briefly)…')
const child = spawn(electronBin, ['.'], {
  cwd: ROOT,
  env: { ...process.env, LABAIK_HOME: home, LABAIK_USERDATA: userData },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
let settled = false
const finish = (ok, why) => {
  if (settled) return
  settled = true
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000).unref()
  // Best-effort cleanup with one delayed retry — the dying Electron can
  // still be writing into userData when the first rm lands.
  const cleanup = () => {
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    try { fs.rmSync(userData, { recursive: true, force: true }) } catch {}
  }
  cleanup()
  setTimeout(cleanup, 2500).unref()
  if (ok) {
    console.log(`  ✅ boot beacon reached (${why})`)
    console.log('\nBOOT SMOKE: PASS')
    process.exit(0)
  } else {
    console.log(`  ❌ ${why}`)
    // Show the tail of what the app DID say — usually contains the
    // uncaught error that killed the main script.
    console.log('\n─── last app output ───')
    console.log(out.split('\n').slice(-25).join('\n'))
    console.log('\nBOOT SMOKE: FAIL')
    process.exit(1)
  }
}

const onData = (d) => {
  out += d.toString()
  if (out.includes(BEACON)) finish(true, `${Date.now() - t0}ms`)
}
const t0 = Date.now()
child.stdout.on('data', onData)
child.stderr.on('data', onData)
child.on('exit', (code, sig) => finish(false, `app exited before beacon (code=${code} sig=${sig})`))
setTimeout(() => finish(false, `beacon not seen within ${TIMEOUT_MS / 1000}s — main script likely crashed`), TIMEOUT_MS)
