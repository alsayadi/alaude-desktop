/**
 * harness — boot the REAL Labaik app and drive it.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Until now the suite had 311 checks and not one of them executed the
 * renderer. It asserted that index.html *contained certain strings*. The
 * only test that ran the real app (test-boot.mjs) asserted exactly one
 * thing: a beacon appeared on stdout.
 *
 * That blind spot is not theoretical. Three real bugs shipped and were
 * found by a human looking at the window, never by the suite:
 *   · inline `code` was styled as an image (display:block), so every
 *     sentence containing it broke into three pieces down the page;
 *   · an invisible toast sat over the composer with pointer-events:auto,
 *     so the app could not be typed into at all;
 *   · a cost badge scored the cheapest model as the most expensive.
 * All three are invisible to a regex over source text and obvious to
 * anything that can actually look at, and touch, a rendered window.
 *
 * DESIGN NOTES (each one is a scar from a real failure this session)
 *   · Zero new dependencies. CDP over the `ws` that ships transitively.
 *     Playwright would be nicer, but this app ships two devDependencies
 *     and a promise that it stays small; a test rig is a poor reason to
 *     break that.
 *   · EVERY CDP call is individually timed out. An occluded Electron
 *     window makes Page.captureScreenshot hang forever rather than fail,
 *     which cost real time to diagnose. A harness that hangs is worse
 *     than one that fails.
 *   · The page target is resolved fresh on connect and can be re-resolved,
 *     because the target id changes when the renderer reloads and a stale
 *     websocket URL simply hangs.
 *   · Hermetic by default: LABAIK_HOME and LABAIK_USERDATA point at fresh
 *     temp dirs, so a test run can never touch real sessions or keys.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BEACON = '[boot] main script completed'

/** Every CDP round-trip gets this ceiling; nothing may hang the suite. */
const CALL_TIMEOUT_MS = 15000

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJson(url, timeoutMs = 3000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  return await res.json()
}

/** Poll the DevTools endpoint until a page target appears. */
async function resolvePageTarget(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error(`no page target on port ${port} within timeout`)
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    /** Everything the page logged, so a test can assert it stayed clean. */
    this.consoleErrors = []
    this.pageErrors = []
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id)
        clearTimeout(timer)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.consoleAPICalled' && /error|warning/.test(msg.params?.type)) {
        this.consoleErrors.push({
          type: msg.params.type,
          text: (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300),
        })
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails
        this.pageErrors.push(String(d?.exception?.description || d?.text || 'unknown').slice(0, 300))
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout after ${CALL_TIMEOUT_MS}ms: ${method}`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * Evaluate a single EXPRESSION in the page and return its value.
   * For multiple statements use `run()`.
   *
   * There is deliberately no cleverness here about which form was passed.
   * A first attempt sniffed for `;` or `return` to decide whether to wrap
   * the source in `return (...)`, and it mis-classified both multi-line
   * bodies AND immediately-invoked arrow functions — each failing as a
   * SyntaxError thrown far from its cause. Two explicit methods cost one
   * word at the call site and remove the whole class of confusion.
   */
  async eval(expression) {
    return this.run(`return (${expression.trim().replace(/;$/, '')})`)
  }

  /** Run a statement BODY in the page; say `return` yourself if you want a value. */
  async run(body) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(() => { ${body} })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error('page threw: ' + String(d.exception?.description || d.text).slice(0, 400))
    }
    return r.result?.value
  }

  /** Poll `expression` until it is truthy. Returns the value. */
  async waitFor(expression, { timeout = 8000, label = expression } = {}) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      try { last = await this.eval(expression); if (last) return last } catch (e) { last = e.message }
      await sleep(120)
    }
    throw new Error(`waitFor timed out: ${label} (last: ${JSON.stringify(last)?.slice(0, 160)})`)
  }

  /**
   * A REAL mouse click at the element's centre — dispatched through the
   * input pipeline, so anything covering the element intercepts it exactly
   * as it would for a user. `el.click()` in JS bypasses hit-testing and
   * would have sailed straight through the cycle-40 blocking toast.
   */
  async click(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`)
    if (!box || box.w === 0) throw new Error(`click: ${selector} not present or zero-sized`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      })
    }
  }

  /** Real text input, not a value assignment. */
  async type(text) { await this.send('Input.insertText', { text }) }

  async key(key, code = key) {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: 0 })
    }
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }

  close() { try { this.ws.close() } catch {} }
}

/**
 * Launch the app hermetically and attach a driver.
 * Always call `close()` — it kills the process and removes the temp dirs.
 */
export async function launchApp({ port = 9300 + (process.pid % 200), timeoutMs = 45000, seedKeys = true } = {}) {
  const electron = path.join(ROOT, 'node_modules', '.bin', 'electron')
  if (!fs.existsSync(electron)) return null   // caller skips gracefully

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-e2e-home-'))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-e2e-ud-'))
  const out = []

  // Seed a dummy credential so the app boots into the ACTUAL UI.
  //
  // Without this the run lands on the login screen, and every sweep is
  // quietly measuring a modal instead of the app: the composer is not
  // exposed, so the blocker sweep found nothing even with a known
  // click-eating bug reverted in. A harness that tests the wrong screen
  // is worse than no harness, because it reports green.
  //
  // The key is never used — nothing in the E2E run sends a message — but
  // it is deliberately an obviously-fake value so that a real request
  // would fail loudly rather than bill anyone.
  if (seedKeys) {
    fs.writeFileSync(
      path.join(home, 'credentials.json'),
      JSON.stringify({ providerApiKeys: { anthropic: 'sk-ant-E2E-DUMMY-KEY-NOT-REAL' } }, null, 2),
    )
  }

  const app = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, LABAIK_HOME: home, LABAIK_USERDATA: userData, LABAIK_E2E: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (b) => out.push(b.toString())
  app.stdout.on('data', collect)
  app.stderr.on('data', collect)

  const cleanup = () => {
    try { app.kill('SIGKILL') } catch {}
    for (const d of [home, userData]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
  }

  try {
    const deadline = Date.now() + timeoutMs
    const wsUrl = await resolvePageTarget(port, deadline)
    const WebSocket = require('ws')
    const ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(wsUrl)
      const t = setTimeout(() => reject(new Error('websocket connect timeout')), 10000)
      s.on('open', () => { clearTimeout(t); resolve(s) })
      s.on('error', (e) => { clearTimeout(t); reject(e) })
    })
    const cdp = new Cdp(ws)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    // Boot is only "done" when the renderer's own final statement ran.
    // Waiting on a fixed sleep is how flaky suites are born.
    const bootDeadline = Date.now() + Math.max(5000, deadline - Date.now())
    while (Date.now() < bootDeadline) {
      if (out.join('').includes(BEACON)) break
      await sleep(200)
    }
    const booted = out.join('').includes(BEACON)

    return {
      cdp, home, userData, booted,
      output: () => out.join(''),
      close: () => { cdp.close(); cleanup() },
    }
  } catch (err) {
    cleanup()
    throw err
  }
}

export { BEACON }
