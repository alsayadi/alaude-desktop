/**
 * Browser Agent — lets the model drive a real Chromium window.
 *
 * Design tradeoff: instead of taking a Playwright / Puppeteer dependency
 * (another 200MB) we reuse Electron's own BrowserWindow. One singleton
 * is created on first tool use, survives across chat turns, and the
 * model's tool calls drive it via `executeJavaScript` on the web contents.
 *
 * Exposed tools (wired into api-worker.js's TOOLS array):
 *   - browser_navigate({ url })
 *   - browser_get_text({ selector? })   — defaults to body
 *   - browser_click({ selector })
 *   - browser_fill({ selector, text })
 *   - browser_screenshot()               — returns base64 PNG
 *
 * Safety:
 *   - Session isolated via a custom partition so the user's Chrome
 *     profile cookies / logins aren't leaked to the model.
 *   - contextIsolation: true + sandbox: true on the agent window, no
 *     Node integration. It's just a browser tab with JS eval from us.
 */

const path = require('path')

let agentWin = null

function _ensureWindow() {
  if (agentWin && !agentWin.isDestroyed()) return agentWin
  const { BrowserWindow } = require('electron')
  agentWin = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Alaude Browser Agent',
    show: true,
    webPreferences: {
      partition: 'persist:alaude-agent',  // isolated cookie jar
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  agentWin.on('closed', () => { agentWin = null })
  // Default page so the user sees something on first launch.
  agentWin.loadURL('about:blank')
  return agentWin
}

async function navigate(url) {
  const win = _ensureWindow()
  // Guard against file:// or javascript: URLs — the model should only
  // browse the open web via this tool.
  const ok = /^https?:\/\//i.test(url) || url.startsWith('about:')
  if (!ok) throw new Error(`Unsupported URL scheme for browser agent: ${url}`)
  await win.loadURL(url)
  // Wait for the page to settle (DOMContentLoaded already fired; give a short
  // beat for JS-heavy SPAs to hydrate).
  await new Promise(r => setTimeout(r, 800))
  const title = win.webContents.getTitle()
  const finalUrl = win.webContents.getURL()
  return { url: finalUrl, title }
}

async function getText(selector) {
  const win = _ensureWindow()
  const sel = selector ? JSON.stringify(selector) : 'null'
  const script = `
    (() => {
      const el = ${sel} ? document.querySelector(${sel}) : document.body
      if (!el) return { error: 'no element matched selector' }
      const txt = (el.innerText || el.textContent || '').trim()
      return { text: txt.slice(0, 20000), length: txt.length }
    })()
  `
  return await win.webContents.executeJavaScript(script, true)
}

async function click(selector) {
  const win = _ensureWindow()
  const sel = JSON.stringify(selector)
  const script = `
    (() => {
      const el = document.querySelector(${sel})
      if (!el) return { ok: false, error: 'no element matched selector' }
      try { el.scrollIntoView({ block: 'center' }) } catch {}
      try {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        el.dispatchEvent(ev)
      } catch (e) { return { ok: false, error: e.message } }
      return { ok: true }
    })()
  `
  const r = await win.webContents.executeJavaScript(script, true)
  if (r && r.ok) await new Promise(x => setTimeout(x, 600))  // settle
  return r
}

async function fill(selector, text) {
  const win = _ensureWindow()
  const sel = JSON.stringify(selector)
  const val = JSON.stringify(String(text ?? ''))
  const script = `
    (() => {
      const el = document.querySelector(${sel})
      if (!el) return { ok: false, error: 'no element matched selector' }
      try { el.focus() } catch {}
      // Works for <input> / <textarea> / contenteditable
      if ('value' in el) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
        if (setter) setter.call(el, ${val})
        else el.value = ${val}
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true }
      }
      if (el.isContentEditable) {
        el.innerText = ${val}
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return { ok: true }
      }
      return { ok: false, error: 'element is not a fillable input / textarea / contenteditable' }
    })()
  `
  return await win.webContents.executeJavaScript(script, true)
}

async function screenshot() {
  const win = _ensureWindow()
  const img = await win.webContents.capturePage()
  const buf = img.toPNG()
  return { mime: 'image/png', base64: buf.toString('base64'), size: buf.length }
}

function close() {
  if (agentWin && !agentWin.isDestroyed()) {
    try { agentWin.close() } catch {}
  }
  agentWin = null
}

// Tool schemas — exported so api-worker.js can inject them into the request.
const TOOLS = [
  { type: 'function', function: {
    name: 'browser_navigate',
    description: 'Open or navigate a Chromium browser window to the given URL. Only http(s) allowed. Returns the final URL (after redirects) and the page title.',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: 'Full URL to navigate to, including http:// or https://' },
    }, required: ['url'] },
  } },
  { type: 'function', function: {
    name: 'browser_get_text',
    description: 'Read the text content of the current page, or of a specific CSS selector. Returns up to 20,000 characters. Use this to read articles, verify form state, or scrape data.',
    parameters: { type: 'object', properties: {
      selector: { type: 'string', description: 'Optional CSS selector. Omit to read the whole page body.' },
    } },
  } },
  { type: 'function', function: {
    name: 'browser_click',
    description: 'Click an element in the current page (buttons, links). Selector must be a CSS query.',
    parameters: { type: 'object', properties: {
      selector: { type: 'string', description: 'CSS selector for the element to click' },
    }, required: ['selector'] },
  } },
  { type: 'function', function: {
    name: 'browser_fill',
    description: 'Type into an input / textarea / contenteditable element. Fires input + change events so React / Vue / etc register the value.',
    parameters: { type: 'object', properties: {
      selector: { type: 'string', description: 'CSS selector for the form field' },
      text: { type: 'string', description: 'Text to fill in' },
    }, required: ['selector', 'text'] },
  } },
  { type: 'function', function: {
    name: 'browser_screenshot',
    description: 'Capture the current browser window as a PNG. Returns base64 + mime. Use for debugging, feeding to vision models, or showing the user what the page looks like.',
    parameters: { type: 'object', properties: {} },
  } },
]

module.exports = { navigate, getText, click, fill, screenshot, close, TOOLS }
