const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, globalShortcut, nativeImage, screen, systemPreferences } = require('electron')
const path = require('path')
const os = require('os')
const http = require('http')
const crypto = require('crypto')

// EPIPE on stdout/stderr crashes the app when the parent shell exits or
// a background-task wrapper reaps our FDs (seen in dev runs launched via
// `npm start &`). Attach a no-op error handler so a closed pipe doesn't
// bubble to Electron's "Uncaught Exception" dialog. Anyone who needs to
// know about a write failure can wrap their own write in try/catch.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => { if (err && err.code !== 'EPIPE') throw err })
}

// Identify as "Alaude" EVERYWHERE macOS might label us — menu bar, About
// panel, notification sender, dock badge, user-data-dir. Happens during
// dev runs (`npm start`), where the Electron binary would otherwise call
// itself "Electron" and the parent process might leak its own name (e.g.
// "Claude" when launching via the Claude CLI) into permission dialogs.
// The packaged DMG already has the right name baked into Info.plist, so
// this is a belt-and-braces measure.
// Pin the user-data directory FIRST (before setName, which would move it).
// Existing users have sessions / localStorage / cookies at
// ~/Library/Application Support/alaude-desktop — if we let Electron
// derive the dir from our app name it'd silently jump to /Alaude and
// orphan everything. If the packaged app didn't pre-create a userData
// dir (first-run on a fresh install) we fall back to Electron's default.
try {
  const fsMod = require('fs')
  const legacyDir = path.join(app.getPath('appData'), 'alaude-desktop')
  const brandedDir = path.join(app.getPath('appData'), 'Alaude')
  // Prefer legacy if it exists (keep existing users' data). Use branded
  // only on a truly fresh install where neither dir has anything.
  if (fsMod.existsSync(legacyDir)) {
    app.setPath('userData', legacyDir)
  } else if (fsMod.existsSync(brandedDir)) {
    app.setPath('userData', brandedDir)
  }
  // Otherwise leave as-is; setName below will produce /Alaude on first run.
} catch {}

app.setName('Labaik')
try { app.setAboutPanelOptions({ applicationName: 'Labaik', credits: 'https://labaik.ai' }) } catch {}
const ollama = require('./ollama')
const modelCatalog = require('./model-catalog')
const ooda = require('./ooda')
const permissions = require('./permissions')
const skills = require('./skills')
const folderSkills = require('./folder-skills')
const mcp = require('./mcp')
const jsonStore = require('./json-store')
const paths = require('./paths')
const { detectProvider, getBaseURL, PROVIDER_KEY_IDS } = require('./provider-registry')

// ── Permission mode persistence (v0.4.0) ──────────────────────────────────
// Stored in ~/.alaude/permissions.json so it survives reinstalls. This
// release only exposes Observe + Autopilot to the UI; Careful/Flow arrive
// in v0.4.1/0.4.2 once the approval dialog lands.
const PERMISSIONS_FILE = path.join(os.homedir(), '.alaude', 'permissions.json')
let permState = null  // { version, defaultMode, workspaces: { [path]: { mode, allow, deny } } }

function loadPermissions() {
  try {
    const fs = require('fs')
    if (!fs.existsSync(PERMISSIONS_FILE)) return { version: 1, defaultMode: 'autopilot', workspaces: {} }
    const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('malformed')
    if (!parsed.workspaces || typeof parsed.workspaces !== 'object') parsed.workspaces = {}
    if (!permissions.MODES.includes(parsed.defaultMode)) parsed.defaultMode = 'autopilot'
    return parsed
  } catch (err) {
    console.warn('[permissions] could not load, using defaults:', err.message)
    return { version: 1, defaultMode: 'autopilot', workspaces: {} }
  }
}
function savePermissions(state) {
  try {
    const fs = require('fs')
    fs.mkdirSync(path.dirname(PERMISSIONS_FILE), { recursive: true })
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[permissions] save failed:', err.message)
  }
}
function getCurrentMode(workspacePath) {
  if (!permState) permState = loadPermissions()
  if (workspacePath && permState.workspaces?.[workspacePath]?.mode) {
    const m = permState.workspaces[workspacePath].mode
    if (permissions.MODES.includes(m)) return m
  }
  return permState.defaultMode
}
function setCurrentMode(workspacePath, mode) {
  if (!permissions.MODES.includes(mode)) return false
  if (!permState) permState = loadPermissions()
  if (workspacePath) {
    if (!permState.workspaces[workspacePath]) permState.workspaces[workspacePath] = {}
    permState.workspaces[workspacePath].mode = mode
  } else {
    permState.defaultMode = mode
  }
  savePermissions(permState)
  return true
}

// v0.7.61: was a third duplicate of detectProvider (for UX telemetry).
// Now just an alias to the shared registry function — the registry is
// the same logic with more providers and no divergence risk.
const detectProviderForUx = detectProvider

function classifyError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  if (msg.includes('connection') || msg.includes('enotfound') || msg.includes('econn')) return 'connection'
  if (msg.includes('timed out') || msg.includes('timeout')) return 'timeout'
  if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('401')) return 'auth'
  if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit'
  if (msg.includes('model')) return 'model'
  return 'other'
}

// ── State ────────────────────────────────────────────────────────────────────

let mainWindow = null
let quickWindow = null
let tray = null

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#f5f5f5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // v0.7.48: pass the app version + homepage via argv because sandboxed
      // preloads can't require('../package.json'). Preload parses these out
      // of process.argv and exposes them on window.alaude.
      additionalArguments: [
        `--alaude-version=${app.getVersion()}`,
        `--alaude-homepage=${(() => { try { return require(path.join(__dirname, '..', 'package.json')).homepage || '' } catch { return '' } })()}`,
      ],
    },
    icon: path.join(__dirname, '..', 'build', 'icons', 'icon.png'),
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  // DEV helper: ALAUDE_DEVTOOLS=1 auto-opens devtools so artifact-iframe
  // script errors surface immediately. Ship as detached pane.
  if (process.env.ALAUDE_DEVTOOLS === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    })
  }

  // Allow DevTools in packaged + dev builds so renderer-side bugs (chart
  // errors, artifact script issues) are debuggable. ⌘⌥I on macOS, Ctrl+Shift+I
  // elsewhere. Also relay any uncaught renderer errors to main's stderr so
  // the log captures them.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const mac = process.platform === 'darwin'
    const opensTools = input.type === 'keyDown' && input.key === 'i' &&
      ((mac && input.meta && input.alt) || (!mac && input.control && input.shift))
    if (opensTools) mainWindow.webContents.toggleDevTools()
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const lvl = ['log','warn','error'][level] || 'log'
    if (lvl === 'error' || lvl === 'warn') {
      // EPIPE-safe: when the parent shell exits (or a background-task
      // wrapper reaps our stderr FD) the next sync write throws EPIPE
      // which Electron surfaces as an "Uncaught Exception" dialog. We
      // can't log the failure-to-log, so just drop it.
      try { process.stderr.write(`[renderer ${lvl}] ${message} (${source}:${line})\n`) } catch {}
    }
  })

  // Intercept every window.open (including target="_blank" link clicks inside
  // AI responses). Electron's default is to create a new BrowserWindow and
  // load the URL inside it — which means a dead localhost link produces
  // "Failed to load URL" spam, and even good URLs open as a stripped-down
  // embedded window instead of the user's real browser.
  //
  // Route all external navigations to the OS default browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://') || url.startsWith('mailto:'))) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Same safety net for in-page navigation (e.g. user drags a URL into the
  // window) — don't let the main renderer ever navigate away from our HTML.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const cur = mainWindow.webContents.getURL()
    if (url !== cur) {
      event.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url)
      }
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── AI Chat backend ─────────────────────────────────────────────────────────

/**
 * Load the credential manager from the alaude source
 */
const SRC_DIR = path.resolve(__dirname, '..', '..', 'claude_code_src')

// Returns { value, isOauth } | null. Prefers (in order): OAuth token from
// the credentials file, API key from the credentials file, env var.
// Env vars are ALWAYS treated as API keys — set your shell if you want
// that path.
function getCredential(provider) {
  const fs = require('fs')
  const envMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    xai: 'XAI_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
  }
  // v0.7.64: credentials now live at ~/.labaik/credentials.json. We
  // still READ from the legacy ~/.claude/.credentials.json (and the
  // `claude-local-src/` dev path) so existing users don't lose access —
  // first-save will copy them over to the new location.
  const credPaths = [
    paths.CREDENTIALS_FILE,
    path.join(os.homedir(), '.claude', '.credentials.json'),
    path.join(os.homedir(), 'claude-local-src', '.credentials.json'),
  ]
  for (const credPath of credPaths) {
    try {
      if (!fs.existsSync(credPath)) continue
      const data = JSON.parse(fs.readFileSync(credPath, 'utf8'))
      const oauth = data?.providerOauthTokens?.[provider]
      if (oauth) return { value: oauth, isOauth: true }
      const apiKey = data?.providerApiKeys?.[provider]
      if (apiKey) return { value: apiKey, isOauth: false }
    } catch {}
  }
  const envKey = process.env[envMap[provider]]
  if (envKey) return { value: envKey, isOauth: false }
  return null
}

// Backwards-compat: some older callers just want the string value. Returns
// null if no credential exists. Callers that care about OAuth vs API
// should use getCredential() directly.
function getApiKey(provider) {
  const c = getCredential(provider)
  return c ? c.value : null
}

// v0.7.61: `detectProvider` and `getBaseURL` moved to
// ./provider-registry.js so main + worker route identically. Imported
// at the top of this file.

// ── OAuth PKCE flow ─────────────────────────────────────────────────────────

const OAUTH_CONFIG = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.com/cai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  scopes: 'user:profile user:inference',
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

ipcMain.handle('oauth-login', async (_, provider) => {
  if (provider === 'anthropic') {
    return await oauthAnthropic()
  }
  throw new Error(`OAuth not supported for ${provider} yet. Use API key instead.`)
})

function oauthAnthropic() {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = generatePKCE()
    const state = base64url(crypto.randomBytes(16))
    const port = 18923 + Math.floor(Math.random() * 100)

    // Start local callback server
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end()
        return
      }

      const url = new URL(req.url, `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')

      if (returnedState !== state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Login failed</h2><p>Invalid state or missing code. Please try again.</p></body></html>')
        server.close()
        reject(new Error('OAuth state mismatch'))
        return
      }

      // Exchange code for tokens
      try {
        const tokenRes = await fetch(OAUTH_CONFIG.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: OAUTH_CONFIG.clientId,
            code,
            redirect_uri: `http://localhost:${port}/callback`,
            code_verifier: verifier,
          }),
        })

        if (!tokenRes.ok) {
          const errText = await tokenRes.text()
          throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`)
        }

        const tokens = await tokenRes.json()
        const accessToken = tokens.access_token

        // Save the OAuth access token under the oauth slot (not the api-key
        // slot) so chatAnthropic can pass it as a Bearer token instead of
        // x-api-key.
        saveCredential('anthropic', accessToken, 'oauth')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f5f5f5"><h2 style="color:#00a846">Logged in!</h2><p>You can close this window and return to Labaik.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>')
        server.close()

        // Notify the renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('login-success', 'anthropic')
        }

        resolve({ provider: 'anthropic', success: true })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Error</h2><p>${err.message}</p></body></html>`)
        server.close()
        reject(err)
      }
    })

    // Fail fast if the random port is already in use (was hanging until the
    // 5-min timeout because no 'error' handler existed on the server).
    server.on('error', (err) => { try { server.close() } catch {}; reject(err) })
    server.listen(port, '127.0.0.1', () => {
      // Build the OAuth URL
      const authUrl = new URL(OAUTH_CONFIG.authorizeUrl)
      authUrl.searchParams.set('client_id', OAUTH_CONFIG.clientId)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('redirect_uri', `http://localhost:${port}/callback`)
      authUrl.searchParams.set('scope', OAUTH_CONFIG.scopes)
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code', 'true')

      // Open browser
      shell.openExternal(authUrl.toString())
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close()
      reject(new Error('Login timed out'))
    }, 300000)
  })
}

function saveCredential(provider, key, kind /* 'api' | 'oauth' */) {
  const fs = require('fs')
  // v0.7.64: writes go to ~/.labaik/credentials.json. Reads still fall
  // back to ~/.claude/.credentials.json until the user saves a key, at
  // which point the new file becomes authoritative.
  const credPath = paths.CREDENTIALS_FILE
  const legacyCredPath = path.join(os.homedir(), '.claude', '.credentials.json')

  let data = {}
  try {
    if (fs.existsSync(credPath)) {
      data = JSON.parse(fs.readFileSync(credPath, 'utf8'))
    } else if (fs.existsSync(legacyCredPath)) {
      // First write after upgrade: seed from the legacy file so other
      // providers' keys don't get wiped when saving one.
      data = JSON.parse(fs.readFileSync(legacyCredPath, 'utf8'))
    }
  } catch {}

  if (kind === 'oauth') {
    if (!data.providerOauthTokens) data.providerOauthTokens = {}
    data.providerOauthTokens[provider] = key
    // Clear any stale API key in the same slot — OAuth wins.
    if (data.providerApiKeys && data.providerApiKeys[provider]) {
      delete data.providerApiKeys[provider]
    }
  } else {
    if (!data.providerApiKeys) data.providerApiKeys = {}
    data.providerApiKeys[provider] = key
    // And clear any stale OAuth token so API-key-set replaces it.
    if (data.providerOauthTokens && data.providerOauthTokens[provider]) {
      delete data.providerOauthTokens[provider]
    }
  }

  paths.ensureBaseDir()
  fs.writeFileSync(credPath, JSON.stringify(data, null, 2), { mode: 0o600 })
}

// ── IPC: Chat ────────────────────────────────────────────────────────────────

// ── API Worker (runs in plain Node.js to avoid Electron network issues) ──────

const { spawn: spawnChild } = require('child_process')

// ── v0.7.40 — dev server lifecycle tracking ──────────────────────────
// Servers started via the worker's start_dev_server tool live as detached
// child processes. Without tracking them, they accumulate across sessions:
// closing Labaik doesn't stop them, so the next test that picks the same
// port silently collides with a zombie server (the recurring "localhost
// serves old files" bug). We store PIDs here and kill them on:
//   - window close (before quit)
//   - new session (renderer sends 'kill-tracked-servers')
// Tracking is lossy across Labaik restarts (servers from a previous run
// are orphaned) — mostly that's fine since they die with the shell; the
// stuck ones are the ones we started in THIS process.
let trackedServers = []
function killAllTrackedServers(reason = 'cleanup') {
  const killed = []
  for (const s of trackedServers) {
    try {
      // Detached children started by `spawn(..., {detached: true})` run as
      // their own process group; -pid kills the whole group.
      try { process.kill(-s.pid, 'SIGTERM') } catch { process.kill(s.pid, 'SIGTERM') }
      killed.push(s.pid)
    } catch (err) {
      // Already dead / permission denied — ignore, continue to next.
    }
  }
  if (killed.length) console.log(`[server-cleanup] killed ${killed.length} tracked server(s) (${reason}):`, killed)
  trackedServers = []
  return killed
}
// Last-chance cleanup when Labaik itself is quitting.
app?.on?.('before-quit', () => killAllTrackedServers('app-quit'))
let apiWorker = null
let requestId = 0
const pendingRequests = new Map()

function getWorker() {
  if (apiWorker && !apiWorker.killed) return apiWorker

  // Binary selection:
  //   Packaged app → always use Electron-as-Node (process.execPath +
  //     ELECTRON_RUN_AS_NODE=1). Guaranteed present inside the .app bundle.
  //     System `node` doesn't exist on every Mac, and even when it does it
  //     can't read files packaged inside app.asar — which is where main.js
  //     lives at runtime.
  //   Dev mode → prefer a real system `node` (slightly snappier startup,
  //     and the original reason we introduced the split). Fall back to
  //     Electron-as-Node if no system node is found.
  const nodeBin = (() => {
    if (app.isPackaged) return process.execPath
    const fsMod = require('fs')
    const candidates = [
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      path.join(os.homedir(), '.nvm/versions/node', 'current', 'bin', 'node'),
    ]
    for (const c of candidates) { if (fsMod.existsSync(c)) return c }
    return process.execPath
  })()
  const workerEnv = { ...process.env }
  if (nodeBin === process.execPath) workerEnv.ELECTRON_RUN_AS_NODE = '1'

  console.log('[worker] spawning with binary:', nodeBin, '(packaged:', app.isPackaged, ')')
  apiWorker = spawnChild(nodeBin, [path.join(__dirname, 'api-worker.js')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: workerEnv,
  })

  // Surface worker-side crashes so "Worker crashed" is actionable, not silent
  apiWorker.on('error', (err) => console.error('[worker] spawn error:', err))
  apiWorker.stderr?.on('data', (chunk) => process.stderr.write(`[worker stderr] ${chunk}`))

  let buf = ''
  apiWorker.stdout.setEncoding('utf8')
  apiWorker.stdout.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      try {
        const resp = JSON.parse(line)
        // Live in-flight events (tool calls, thinking steps). Forward to
        // renderer but DON'T resolve the pending promise — the final
        // {id, result} still follows.
        if (resp.activity) {
          // Route activity to the window that actually sent this request.
          // Broadcasting to both windows leaked Quick-window tool calls onto
          // the main chat (and vice versa) when both were in use.
          const pendingForActivity = pendingRequests.get(resp.id)
          const sender = pendingForActivity?.sender
          try {
            if (sender && !sender.isDestroyed()) sender.send('tool-activity', resp.activity)
            else mainWindow?.webContents?.send('tool-activity', resp.activity)
          } catch {}
          // Each activity tick resets the "no progress" idle timer. Long
          // website-builds etc. that stream for minutes now stay alive.
          try { pendingForActivity?.onActivity?.() } catch {}
          continue
        }
        // v0.7.40: worker spawned a dev server via start_dev_server. Track
        // its PID so we can kill it on window close / new session — avoids
        // the "stale Python server holding port 8000" bug where every new
        // test started a new server on top of a zombie one.
        if (resp.type === 'server_started' && typeof resp.pid === 'number') {
          trackedServers.push({
            pid: resp.pid,
            port: resp.port,
            command: resp.command,
            workspacePath: resp.workspacePath,
            startedAt: Date.now(),
          })
          // Cap memory: keep the last 20 (oldest dropped, but still killed
          // as part of killAllTrackedServers on app quit).
          if (trackedServers.length > 20) trackedServers = trackedServers.slice(-20)
          continue
        }
        // v0.5.6: MCP tool bridge. Worker asks main for the current MCP
        // tool schemas (so it can merge them into the request) or to execute
        // an MCP tool call. Same shape as the browser-tool bridge.
        if (resp.type === 'mcp-list') {
          try { apiWorker?.stdin.write(JSON.stringify({ type: 'mcp-list-response', id: resp.id, tools: mcp.getToolSchemas() }) + '\n') } catch {}
          continue
        }
        if (resp.type === 'mcp-call') {
          ;(async () => {
            let result
            try { result = await mcp.callTool(resp.name, resp.args || {}) }
            catch (err) { result = { error: String(err?.message || err) } }
            try { apiWorker?.stdin.write(JSON.stringify({ type: 'mcp-call-response', id: resp.id, result }) + '\n') } catch {}
          })()
          continue
        }
        // v0.5.5: Browser Agent tool request from the worker. We run the
        // actual Electron BrowserWindow API here in main (the worker can't
        // touch BrowserWindow) and write the result back to its stdin.
        if (resp.type === 'browser-tool') {
          const bA = require('./browser-agent')
          ;(async () => {
            let result
            try {
              const a = resp.args || {}
              if (resp.name === 'browser_navigate') result = await bA.navigate(a.url)
              else if (resp.name === 'browser_get_text') result = await bA.getText(a.selector)
              else if (resp.name === 'browser_click') result = await bA.click(a.selector)
              else if (resp.name === 'browser_fill') result = await bA.fill(a.selector, a.text)
              else if (resp.name === 'browser_screenshot') result = await bA.screenshot()
              else result = { error: `unknown browser tool: ${resp.name}` }
            } catch (err) {
              result = { error: String(err?.message || err) }
            }
            try { apiWorker?.stdin.write(JSON.stringify({ type: 'browser-tool-response', id: resp.id, result }) + '\n') } catch {}
          })()
          continue
        }
        // v0.5.10: Screen control tool request (full desktop, not just browser).
        if (resp.type === 'screen-tool') {
          const sC = require('./screen-control')
          ;(async () => {
            let result
            try {
              const a = resp.args || {}
              if (resp.name === 'screen_click') result = await sC.click(a)
              else if (resp.name === 'screen_type') result = await sC.type(a)
              else if (resp.name === 'screen_key') result = await sC.key(a)
              else if (resp.name === 'screen_move_mouse') result = await sC.moveMouse(a)
              else result = { error: `unknown screen tool: ${resp.name}` }
            } catch (err) {
              result = { error: String(err?.message || err) }
            }
            try { apiWorker?.stdin.write(JSON.stringify({ type: 'screen-tool-response', id: resp.id, result }) + '\n') } catch {}
          })()
          continue
        }
        const pending = pendingRequests.get(resp.id)
        if (pending) {
          pendingRequests.delete(resp.id)
          if (resp.error) pending.reject(new Error(resp.error))
          else pending.resolve(resp.result)
        }
      } catch {}
    }
  })

  apiWorker.on('exit', () => {
    apiWorker = null
    for (const [id, p] of pendingRequests) {
      p.reject(new Error('Worker crashed'))
      pendingRequests.delete(id)
    }
  })

  return apiWorker
}

ipcMain.handle('chat', async (event, messagesRaw, model, workspacePath, spaceId, uxMeta) => {
  const id = ++requestId
  const worker = getWorker()
  const senderWebContents = event?.sender

  // Compose system prompt from active space
  let spacePrompt = ''
  if (spaceId) {
    const builtIn = getSpaceById(spaceId)
    if (builtIn && builtIn.id === spaceId) {
      spacePrompt = builtIn.systemPromptAddition || ''
    } else {
      const custom = spacesStore.getCustomSpaces().find(s => s.id === spaceId)
      spacePrompt = custom?.systemPromptAddition || ''
    }
  }

  // ── OODA: log chat_send ──
  const messageId = uxMeta?.messageId || `m_${id}_${Date.now()}`
  const sessionId = uxMeta?.sessionId || 'unknown'
  const lastUser = messagesRaw.slice().reverse().find(m => m.role === 'user')
  const promptLen = lastUser ? String(lastUser.content || '').length : 0
  const provider = detectProviderForUx(model)
  const sendTs = Date.now()
  ooda.logEvent({
    kind: 'chat_send',
    sessionId,
    messageId,
    space: spaceId || 'general',
    provider,
    model: model || '',
    entry: uxMeta?.entry || 'freeform',
    action: uxMeta?.action || null,
    hasWorkspace: !!workspacePath,
    hasAttachments: !!uxMeta?.hasAttachments,
    promptHash: uxMeta?.promptHash || null,
    promptLen,
  })

  const finalize = (success, errorMsg, responseLen) => {
    ooda.logEvent({
      kind: success ? 'chat_complete' : 'chat_error',
      sessionId,
      messageId,
      success,
      latencyMs: Date.now() - sendTs,
      errorType: success ? null : classifyError(errorMsg),
      errorMsg: success ? null : String(errorMsg || '').slice(0, 200),
      responseLen: responseLen || 0,
    })
    // chat_complete-kinded event must exist for outcome builder — emit a synthetic
    // completion marker on error too so the outcome is captured.
    if (!success) {
      ooda.logEvent({
        kind: 'chat_complete',
        sessionId,
        messageId,
        success: false,
        latencyMs: Date.now() - sendTs,
        errorType: classifyError(errorMsg),
      })
    }
    // Fire-and-forget batch check
    setImmediate(() => {
      const res = ooda.maybeRunBatch()
      if (res?.ran) console.log(`[ooda] batch #${res.batchId} ran — ${res.diagnosis?.problem}`)
    })
  }

  return new Promise((resolve, reject) => {
    // Activity-based idle timeout. Previous design was a hard wall-clock
    // cap (2 min cloud / 10 min local) that killed legit long workflows
    // like 'build me a website' — models that tool-call + stream for 3+
    // min would get cut off even though every turn was making progress.
    // Now: each activity event (token chunk, tool_start, tool_end,
    // file_edit, thinking) resets the timer. Only a genuinely silent
    // provider/worker bails out.
    const isLocalModel = provider === 'ollama'
    // Shorter idle cap because "no activity for N seconds" is a much
    // stronger signal than total elapsed time. Local gets longer to
    // account for weight loading on first call.
    const IDLE_MS = isLocalModel ? 5 * 60 * 1000 : 90 * 1000
    // Absolute ceiling so a model in an infinite tool-loop doesn't burn
    // credits forever even if it keeps emitting activity.
    const ABS_MS = isLocalModel ? 30 * 60 * 1000 : 15 * 60 * 1000
    let idleTimer = null
    const absTimer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        const err = new Error(`Request exceeded hard cap (${Math.round(ABS_MS / 60000)} min). The model was still producing but hit the overall safety ceiling — split the task into smaller turns.`)
        finalize(false, err); reject(err)
      }
    }, ABS_MS)
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          clearTimeout(absTimer)
          const secs = Math.round(IDLE_MS / 1000)
          const err = new Error(`No activity for ${secs}s. ${isLocalModel
            ? 'Local model may be stuck — check Ollama is running and try a shorter prompt.'
            : 'Provider is silent — could be rate-limit, a dead socket, or network trouble.'}`)
          finalize(false, err); reject(err)
        }
      }, IDLE_MS)
    }
    pendingRequests.set(id, {
      sender: senderWebContents,
      resolve: (result) => {
        clearTimeout(absTimer); if (idleTimer) clearTimeout(idleTimer)
        finalize(true, null, String(result || '').length); resolve(result)
      },
      reject: (err) => {
        clearTimeout(absTimer); if (idleTimer) clearTimeout(idleTimer)
        finalize(false, err); reject(err)
      },
      // Called from the activity forwarder whenever the worker emits a
      // token / tool_start / tool_end / file_edit / thinking event.
      onActivity: armIdle,
    })
    // Pass the current permission mode for this workspace so the worker can
    // gate tool execution before the OS-level tool call actually runs.
    const mode = getCurrentMode(workspacePath)
    // v0.7.67 — plan mode propagates from the renderer through uxMeta. The
    // worker uses it to swap in the plan-only system prompt and skip tool
    // offerings so the model can't sneak past the "no execution" rule.
    const planMode = !!uxMeta?.planMode
    const req = JSON.stringify({ id, messageId, messages: messagesRaw, model, workspacePath, spacePrompt, mode, planMode }) + '\n'
    console.log('[chat] sending to worker, id:', id, 'space:', spaceId || 'general')
    worker.stdin.write(req, 'utf8')
    armIdle()
  })
})

// ── OODA IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle('ux-event', (_e, event) => {
  try { ooda.logEvent(event); return true } catch { return false }
})
ipcMain.handle('ux-insights', () => ooda.getLatestSummary())
ipcMain.handle('ux-run-batch', () => ooda.maybeRunBatch({ force: true }))

async function chatAnthropic(messagesRaw, model, workspacePath) {
  const AnthropicModule = require('@anthropic-ai/sdk')
  const Anthropic = AnthropicModule.default || AnthropicModule
  const apiKey = getApiKey('anthropic')
  if (!apiKey) throw new Error('No Anthropic API key. Click "API Keys" in the top right to add one.')

  const client = new Anthropic({ apiKey, timeout: 60000 })

  const systemPrompt = workspacePath
    ? `You are Labaik, an AI coding assistant. You have access to the user's workspace at: ${workspacePath}\n\nYou can read files, write files, list directories, and run shell commands. Use the provided tools to help the user. When writing code, always use write_file. Always explain what you're doing.`
    : 'You are Labaik, an AI coding assistant.'

  const anthropicTools = workspacePath ? TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  })) : undefined

  const messages = messagesRaw.map(m => ({ role: m.role, content: m.content }))

  let fullResponse = ''
  let toolLog = ''

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: model || 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    })

    // Collect text
    for (const block of response.content) {
      if (block.type === 'text') fullResponse += block.text
    }

    // Handle tool use
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    if (toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content })

      const toolResults = []
      for (const tu of toolUseBlocks) {
        console.log(`[tool] ${tu.name}(${JSON.stringify(tu.input).slice(0, 200)})`)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tool-activity', tu.name, tu.input)
        }

        const result = executeToolCall(tu.name, tu.input, workspacePath)

        if (tu.name === 'write_file') toolLog += `\n📝 Wrote \`${tu.input.path}\``
        else if (tu.name === 'read_file') toolLog += `\n📖 Read \`${tu.input.path}\``
        else if (tu.name === 'list_directory') toolLog += `\n📁 Listed \`${tu.input.path || '.'}\``
        else if (tu.name === 'run_command') {
          toolLog += `\n⚡ Ran \`${tu.input.command}\``
          if (result.output) toolLog += `\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``
        }

        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    break
  }

  return (fullResponse + toolLog) || '(Done)'
}

async function chatOpenAI(messagesRaw, model, provider, workspacePath) {
  const OpenAIModule = require('openai')
  const OpenAI = OpenAIModule.default || OpenAIModule
  const apiKey = getApiKey(provider)
  if (!apiKey) throw new Error(`No ${provider} API key. Click "API Keys" in the top right to add one.`)

  const baseURL = getBaseURL(provider)
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 60000 })

  const systemMsg = workspacePath
    ? `You are Labaik, an AI coding assistant. You have access to the user's workspace at: ${workspacePath}\n\nYou can read files, write files, list directories, and run shell commands. Use the provided tools to help the user with coding tasks. When writing code, always use write_file to save it. When the user asks to see files, use read_file. Always explain what you're doing.`
    : 'You are Labaik, an AI coding assistant. Help the user with coding questions and tasks.'

  const messages = [
    { role: 'system', content: systemMsg },
    ...messagesRaw.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ]

  const useTools = workspacePath ? TOOLS : undefined
  let fullResponse = ''
  let toolLog = ''

  // Tool-calling loop (max 10 rounds)
  for (let i = 0; i < 10; i++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: 4096,
      ...(useTools ? { tools: useTools, tool_choice: 'auto' } : {}),
    })

    const choice = response.choices?.[0]
    const msg = choice?.message
    if (!msg) break

    // Add assistant response to conversation
    messages.push(msg)

    // Collect text content
    if (msg.content) fullResponse += msg.content

    // Handle tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments || '{}')
        console.log(`[tool] ${tc.function.name}(${JSON.stringify(args).slice(0, 200)})`)

        // Notify renderer about tool activity
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tool-activity', tc.function.name, args)
        }

        const result = executeToolCall(tc.function.name, args, workspacePath)
        const resultStr = JSON.stringify(result)

        // Build tool activity log for display
        if (tc.function.name === 'write_file') {
          toolLog += `\n📝 Wrote \`${args.path}\``
        } else if (tc.function.name === 'read_file') {
          toolLog += `\n📖 Read \`${args.path}\``
        } else if (tc.function.name === 'list_directory') {
          toolLog += `\n📁 Listed \`${args.path || '.'}\``
        } else if (tc.function.name === 'run_command') {
          toolLog += `\n⚡ Ran \`${args.command}\``
          if (result.output) toolLog += `\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        })
      }
      continue // go another round so the model can respond with text
    }

    // No tool calls — we're done
    break
  }

  return (fullResponse + toolLog) || '(Done — no text response)'
}

async function chatGemini(messagesRaw, model) {
  const { GoogleGenAI } = require('@google/genai')
  const apiKey = getApiKey('google')
  if (!apiKey) throw new Error('No Gemini API key. Click "API Keys" in the top right to add one.')

  const client = new GoogleGenAI({ apiKey })

  const chatMessages = messagesRaw.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const response = await client.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents: chatMessages,
  })

  return response.text || ''
}

// ── IPC: Permission modes (v0.4.0) ──────────────────────────────────────────

ipcMain.handle('perm-get-mode', (_e, workspacePath) => {
  const mode = getCurrentMode(workspacePath)
  return { mode, meta: permissions.MODE_META[mode], allModes: permissions.MODES, allMeta: permissions.MODE_META }
})

ipcMain.handle('perm-set-mode', (_e, workspacePath, mode) => {
  return setCurrentMode(workspacePath, mode)
})

ipcMain.handle('perm-cycle-mode', (_e, workspacePath) => {
  const current = getCurrentMode(workspacePath)
  const next = permissions.nextMode(current)
  setCurrentMode(workspacePath, next)
  return { mode: next, meta: permissions.MODE_META[next] }
})

ipcMain.handle('perm-get-state', () => {
  if (!permState) permState = loadPermissions()
  return permState
})

// ── IPC: Cron Skills (v0.5.4) ─────────────────────────────────────────────
// Scheduled background chats. Read/write/list/toggle skills; the actual
// firing happens inside the scheduler started at app-ready, which pipes
// through the same `chat` IPC so skill runs share provider creds, memory,
// and the api-worker's tool pipeline.
ipcMain.handle('skills-list', () => skills.list())
ipcMain.handle('skills-upsert', (_e, skill) => skills.upsert(skill))
ipcMain.handle('skills-remove', (_e, id) => { skills.remove(id); return true })
ipcMain.handle('skills-set-enabled', (_e, id, enabled) => skills.setEnabled(id, enabled))

// ── IPC: folder-skills (v0.7.67) ─────────────────────────────────────────
// Filesystem-discovered skill templates from ~/.labaik/skills/<slug>/SKILL.md.
// Distinct concept from cron-routines above; see electron/folder-skills.js
// for the rationale on the naming overlap.
ipcMain.handle('folder-skills-list', () => {
  folderSkills.ensureRoot()  // creates dir + README on first call
  return { skills: folderSkills.discover(), root: folderSkills.getRoot() }
})
ipcMain.handle('folder-skills-get', (_e, slug) => folderSkills.get(slug))

// ── IPC: durable JSON store (v0.7.59) ─────────────────────────────────────
// Renderer-side stores (memory, profile, eventually sessions) used to live
// in Chromium localStorage, which batches writes to LevelDB asynchronously
// and can lose the most recent writes on SIGTERM/crash. These sync channels
// write through to `~/.alaude/{name}.json` with an atomic tmp+rename so
// data is durable by the time setItem returns. Small files, <5ms each —
// the sync block is a fair price for not losing users' memories.
ipcMain.on('fs-json-read-sync', (e, name) => {
  try { e.returnValue = jsonStore.read(name) } catch { e.returnValue = null }
})
ipcMain.on('fs-json-write-sync', (e, name, data) => {
  try { e.returnValue = jsonStore.write(name, data) } catch { e.returnValue = false }
})

// ── IPC: MCP (v0.5.6) ─────────────────────────────────────────────────────
ipcMain.handle('mcp-status', () => mcp.listStatus())
ipcMain.handle('mcp-add-server', async (_e, cfg) => {
  const srv = await mcp.addServer(cfg)
  return { name: srv.name, status: srv.status, toolCount: srv.tools.length, error: srv.error }
})
ipcMain.handle('mcp-remove-server', async (_e, name) => mcp.removeServer(name))
ipcMain.handle('mcp-get-config', () => mcp.loadConfig())

// ── IPC: Key management ─────────────────────────────────────────────────────

ipcMain.handle('get-key-statuses', async () => {
  // v0.7.61: PROVIDER_KEY_IDS lives in provider-registry.js so adding
  // a new provider there surfaces it in this status response + the
  // renderer's Keys modal without a hardcoded list to keep in sync.
  const result = {}
  for (const p of PROVIDER_KEY_IDS) {
    const key = getApiKey(p)
    result[p] = key ? 'set' : 'none'
  }
  // Local Ollama runtime counts as a connected "provider" for onboarding —
  // a user who has Ollama running with any installed model should not be
  // stuck on the login screen asking for a cloud API key.
  try {
    if (await ollama.isAvailable()) {
      const installed = await ollama.listInstalled()
      result.ollama = (Array.isArray(installed) && installed.length) ? 'set' : 'available'
    } else {
      result.ollama = 'none'
    }
  } catch { result.ollama = 'none' }
  return result
})

ipcMain.handle('set-key', async (_, provider, key) => {
  try {
    saveCredential(provider, key)
    console.log(`[set-key] Saved key for ${provider}`)
    return true
  } catch (err) {
    console.error('[set-key] Failed:', err)
    return false
  }
})

// ── Ollama local runtime ────────────────────────────────────────────────────
// Tracks in-flight pulls so the UI can cancel them.
const activePulls = new Map() // model -> cancelFn

ipcMain.handle('ollama-available', async () => ollama.isAvailable())

// v0.6.0: Semantic memory. Thin wrapper around ollama.embed — embeds a
// batch of strings via /api/embed. Returns [] if Ollama is down or no
// embedding model is installed; the renderer then falls back to keyword
// recall so memory never becomes unavailable.
ipcMain.handle('ollama-embed', async (_e, texts, model) => {
  try {
    if (!(await ollama.isAvailable())) return { ok: false, reason: 'ollama-down' }
    const m = model || (await ollama.findEmbedModel())
    if (!m) return { ok: false, reason: 'no-embed-model' }
    const embeddings = await ollama.embed(texts, m)
    return { ok: true, model: m, embeddings }
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err?.message || err) }
  }
})
ipcMain.handle('ollama-find-embed-model', async () => {
  try { return await ollama.findEmbedModel() } catch { return null }
})

ipcMain.handle('ollama-list', async () => ollama.listInstalled())

// v0.5.0: in-app Ollama installer. No website trip. Progress streams back
// to renderer via `ollama-install-progress` events.
ipcMain.handle('ollama-install', async (event) => {
  try {
    const result = await ollama.installOllama({
      onProgress: (p) => {
        try { event.sender.send('ollama-install-progress', p) } catch {}
      },
    })
    return result
  } catch (err) {
    try { event.sender.send('ollama-install-progress', { phase: 'error', pct: null, message: err.message || String(err) }) } catch {}
    throw err
  }
})

ipcMain.handle('ollama-catalog', async () => modelCatalog)

ipcMain.handle('ollama-pull', async (event, model) => {
  if (!model || typeof model !== 'string') throw new Error('Model name required')
  if (activePulls.has(model)) throw new Error(`Already pulling ${model}`)

  const { promise, cancel } = ollama.pull(model, (progress) => {
    try {
      event.sender.send('model-download-progress', { model, ...progress })
    } catch {}
  })
  activePulls.set(model, cancel)

  try {
    await promise
    return { ok: true }
  } catch (err) {
    // AbortError from cancel() — surface as a clean cancel status
    if (err.name === 'AbortError') return { ok: false, cancelled: true }
    throw err
  } finally {
    activePulls.delete(model)
  }
})

ipcMain.handle('ollama-cancel', async (_e, model) => {
  const cancel = activePulls.get(model)
  if (!cancel) return false
  cancel()
  activePulls.delete(model)
  return true
})

ipcMain.handle('ollama-remove', async (_e, model) => {
  await ollama.remove(model)
  return true
})

// ── File tools ──────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path (relative to workspace)',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative file path' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file at the given path (relative to workspace). Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory (relative to workspace)',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative directory path (use "." for workspace root)' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace directory. Use for npm install, git, build, test, etc.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to run' } },
        required: ['command'],
      },
    },
  },
]

function executeToolCall(name, args, workspacePath) {
  const fs = require('fs')
  const { execSync } = require('child_process')

  if (!workspacePath) return { error: 'No workspace folder selected. Ask the user to choose a folder.' }

  try {
    if (name === 'read_file') {
      const fullPath = path.resolve(workspacePath, args.path)
      if (!fullPath.startsWith(workspacePath)) return { error: 'Path outside workspace' }
      const content = fs.readFileSync(fullPath, 'utf8')
      return { content: content.slice(0, 50000) } // cap at 50k chars
    }

    if (name === 'write_file') {
      const fullPath = path.resolve(workspacePath, args.path)
      if (!fullPath.startsWith(workspacePath)) return { error: 'Path outside workspace' }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, args.content, 'utf8')
      return { success: true, path: args.path }
    }

    if (name === 'list_directory') {
      const dirPath = path.resolve(workspacePath, args.path || '.')
      if (!dirPath.startsWith(workspacePath)) return { error: 'Path outside workspace' }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return {
        entries: entries
          .filter(e => !e.name.startsWith('.') || e.name === '.env')
          .slice(0, 100)
          .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n'),
      }
    }

    if (name === 'run_command') {
      const output = execSync(args.command, {
        cwd: workspacePath,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${path.join(os.homedir(), '.bun', 'bin')}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
      })
      return { output: output.slice(0, 20000) }
    }

    return { error: `Unknown tool: ${name}` }
  } catch (err) {
    return { error: err.message || String(err) }
  }
}

// ── IPC: File handling ──────────────────────────────────────────────────────

ipcMain.handle('read-file-for-chat', async (_, filePath) => {
  const fs = require('fs')
  const ext = path.extname(filePath).toLowerCase()
  const name = path.basename(filePath)
  const stats = fs.statSync(filePath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1)

  // Hard cap — anything bigger freezes the main process while pdf-parse /
  // mammoth / XLSX load the entire buffer.
  const MAX_BYTES = 20 * 1024 * 1024
  if (stats.size > MAX_BYTES) {
    return { type: 'error', name, error: `File too large (${sizeMB} MB > 20 MB limit)` }
  }

  try {
    // Images → base64
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      return { type: 'image', name, base64, mime, size: sizeMB }
    }

    // PDF
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse')
      const data = fs.readFileSync(filePath)
      const result = await pdfParse(data)
      return { type: 'document', name, text: result.text, pages: result.numpages, size: sizeMB }
    }

    // Word
    if (ext === '.docx') {
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return { type: 'document', name, text: result.value, size: sizeMB }
    }

    // CSV / Excel
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      const XLSX = require('xlsx')
      const wb = XLSX.readFile(filePath)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const text = XLSX.utils.sheet_to_csv(sheet)
      const rows = text.split('\n').length
      return { type: 'data', name, text, rows, size: sizeMB }
    }

    // Plain text
    const text = fs.readFileSync(filePath, 'utf8')
    return { type: 'text', name, text: text.slice(0, 100000), size: sizeMB }
  } catch (err) {
    return { type: 'error', name, error: err.message }
  }
})

// v0.6.0: Screen Vision — macOS screencapture CLI grabs a region (default),
// the whole screen, or the frontmost window. The PNG path flows through the
// same read-file-for-chat pipeline so the attachment chip + base64 encode +
// vision-model routing all work without extra plumbing.
ipcMain.handle('capture-screen', async (_e, mode = 'region') => {
  const { spawn } = require('child_process')
  const fs = require('fs')
  const tmpDir = path.join(os.tmpdir(), 'alaude-screenshots')
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch {}
  const outPath = path.join(tmpDir, `shot-${Date.now()}.png`)
  const args = ['-x']  // -x: no shutter sound
  if (mode === 'region') args.push('-s')       // interactive crosshair select
  else if (mode === 'window') args.push('-Wo') // window pick, no drop shadow
  // else 'screen' — no extra flags → full primary screen
  args.push(outPath)

  return new Promise((resolve, reject) => {
    // Hide the window briefly so the user can capture underneath the app.
    const wasVisible = mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()
    if (wasVisible && mode !== 'screen') {
      try { mainWindow.hide() } catch {}
    }
    const child = spawn('/usr/sbin/screencapture', args, { stdio: 'ignore' })
    child.on('error', (err) => {
      if (wasVisible) try { mainWindow.show() } catch {}
      reject(new Error('screencapture failed: ' + err.message))
    })
    child.on('close', (code) => {
      if (wasVisible) try { mainWindow.show(); mainWindow.focus() } catch {}
      if (code !== 0) {
        // User pressed Esc during -s region select — not an error, just null.
        try { fs.unlinkSync(outPath) } catch {}
        return resolve(null)
      }
      if (!fs.existsSync(outPath)) return resolve(null)
      const stats = fs.statSync(outPath)
      if (stats.size < 100) { // likely empty / cancelled
        try { fs.unlinkSync(outPath) } catch {}
        return resolve(null)
      }
      resolve(outPath)
    })
  })
})

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] },
      { name: 'Data', extensions: ['csv', 'xlsx', 'xls', 'json'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('save-file', async (_, content, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'output.txt',
  })
  if (result.canceled || !result.filePath) return null
  const fs = require('fs')
  fs.writeFileSync(result.filePath, content, 'utf8')
  return result.filePath
})

// Save a binary buffer (pptx/docx/xlsx/pdf/etc.) via the native save dialog.
// Returns { path, size, name, mtime } or null if the user cancelled.
ipcMain.handle('save-binary-file', async (_, arrayBuffer, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'output.bin',
  })
  if (result.canceled || !result.filePath) return null
  const fs = require('fs')
  const path = require('path')
  const buf = Buffer.from(arrayBuffer)
  fs.writeFileSync(result.filePath, buf)
  const stat = fs.statSync(result.filePath)
  return {
    path: result.filePath,
    size: stat.size,
    name: path.basename(result.filePath),
    mtime: stat.mtimeMs,
  }
})

// Open a previously-saved file in its OS default application.
// Returns true on success; a string error message otherwise.
ipcMain.handle('open-path', async (_, filePath) => {
  if (!filePath) return 'no path'
  const err = await shell.openPath(filePath)
  return err ? err : true
})

// Reveal a saved file in Finder / Explorer (so the user can see it lived).
ipcMain.handle('show-in-folder', async (_, filePath) => {
  if (!filePath) return false
  try { shell.showItemInFolder(filePath); return true } catch { return false }
})

// ── IPC: Spaces ─────────────────────────────────────────────────────────────

const { BUILT_IN_SPACES, getSpaceById } = require('./spaces.js')
const spacesStore = require('./spaces-store.js')

ipcMain.handle('get-spaces', () => {
  const custom = spacesStore.getCustomSpaces()
  return { builtIn: BUILT_IN_SPACES, custom, activeSpaceId: spacesStore.getActiveSpaceId() }
})

ipcMain.handle('set-active-space', (_, id) => {
  return spacesStore.setActiveSpaceId(id)
})

ipcMain.handle('save-custom-space', (_, space) => {
  return spacesStore.saveCustomSpace(space)
})

ipcMain.handle('delete-custom-space', (_, id) => {
  return spacesStore.deleteCustomSpace(id)
})

ipcMain.handle('get-space-prompt', (_, spaceId) => {
  // Check built-in first, then custom
  const builtIn = getSpaceById(spaceId)
  if (builtIn && builtIn.id === spaceId) return builtIn.systemPromptAddition || ''
  const custom = spacesStore.getCustomSpaces().find(s => s.id === spaceId)
  return custom?.systemPromptAddition || ''
})

// ── IPC: Folder picker ──────────────────────────────────────────────────────

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose working directory',
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

// v0.7.32 — "Looks like existing project" detector.
// Returns true if the given folder has any of the markers that a
// human developer would recognize as an established project. When it
// does, auto-scope stays off — the user is presumably editing that
// project, not scratching a new one beside it.
//
// Signals checked (any single hit = project):
//   - .git / directory
//   - Common build/package manifests: package.json, Cargo.toml,
//     pyproject.toml, go.mod, Gemfile, composer.json, pnpm-lock.yaml,
//     deno.json, mix.exs
//   - Xcode / iOS projects: *.xcodeproj / *.xcworkspace
//   - README.md AND >10 other files at root (existing prose project)
//
// Errors (unreadable dir, missing, etc.) → treated as "not a project"
// so auto-scope can still kick in on a best-effort basis.
ipcMain.handle('task-scope-looks-like-project', async (_e, folderPath) => {
  const fs = require('fs')
  try {
    if (typeof folderPath !== 'string' || !folderPath) return false
    const st = fs.statSync(folderPath)
    if (!st.isDirectory()) return false
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    const names = entries.map(e => e.name)
    // Hot-exit markers
    const markers = new Set([
      '.git', 'package.json', 'Cargo.toml', 'pyproject.toml',
      'go.mod', 'Gemfile', 'composer.json', 'pnpm-lock.yaml',
      'yarn.lock', 'deno.json', 'mix.exs', 'pubspec.yaml',
      'CMakeLists.txt', 'Makefile', 'build.gradle', 'pom.xml',
    ])
    for (const n of names) {
      if (markers.has(n)) return true
      if (n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace')) return true
    }
    // README + substantive contents — looks like something already going on.
    const hasReadme = names.some(n => /^README(\.md|\.txt)?$/i.test(n))
    if (hasReadme && names.filter(n => !n.startsWith('.')).length > 10) return true
    return false
  } catch {
    return false
  }
})

// v0.7.40 — server lifecycle IPC.
// Renderer calls these on new-session / explicit cleanup action.
ipcMain.handle('kill-tracked-servers', async () => {
  const killed = killAllTrackedServers('renderer-request')
  return { killed: killed.length, pids: killed }
})
ipcMain.handle('list-tracked-servers', async () => {
  // Return a shallow copy — renderer uses this to show a warning before
  // starting a new server on a port it's about to conflict with.
  return trackedServers.map(s => ({ pid: s.pid, port: s.port, startedAt: s.startedAt, workspacePath: s.workspacePath }))
})
ipcMain.handle('port-in-use', async (_e, port) => {
  // Cheap check via `lsof -i :PORT`. Returns the PID if occupied, null if free.
  const { execSync } = require('child_process')
  try {
    const out = execSync(`lsof -nP -i :${port} -t 2>/dev/null | head -1`, { encoding: 'utf8', timeout: 2000 }).trim()
    return out ? { occupied: true, pid: parseInt(out, 10) } : { occupied: false }
  } catch {
    // lsof missing or exec failed — assume free
    return { occupied: false }
  }
})

// v0.7.31 — Task Scope.
// Creates a subfolder under `parent`, returns the absolute path.
// Hardened against three classes of abuse:
//   1. `name` must not contain path separators or parent refs ("..")
//   2. resolved target must stay strictly inside `parent` (symlink trap)
//   3. max 80 chars for the folder name (sane filesystem limit)
// If a folder of the exact name already exists, returns its path — idempotent,
// no error. If the name collides but would overwrite a non-directory, errors.
ipcMain.handle('task-scope-create-folder', async (_e, parent, name) => {
  const fs = require('fs')
  try {
    if (typeof parent !== 'string' || !parent) return { ok: false, reason: 'no-parent' }
    if (typeof name !== 'string' || !name) return { ok: false, reason: 'no-name' }
    const cleanName = String(name).trim()
    if (!cleanName || cleanName.length > 80) return { ok: false, reason: 'bad-name' }
    // No separators, no '..', no reserved names on macOS
    if (/[\\\/]|\.\./.test(cleanName)) return { ok: false, reason: 'unsafe-name' }
    if (/^(\.DS_Store|Icon\r)$/.test(cleanName)) return { ok: false, reason: 'reserved-name' }
    const target = path.resolve(parent, cleanName)
    const parentResolved = path.resolve(parent)
    // Belt + suspenders: ensure target is inside parent after resolution
    if (!target.startsWith(parentResolved + path.sep) && target !== parentResolved) {
      return { ok: false, reason: 'escape' }
    }
    // Parent must exist and be a directory
    if (!fs.existsSync(parentResolved)) return { ok: false, reason: 'parent-missing' }
    const parentStat = fs.statSync(parentResolved)
    if (!parentStat.isDirectory()) return { ok: false, reason: 'parent-not-dir' }
    // Target: create if absent, allow if already a directory (idempotent),
    // fail if a non-directory exists at the path.
    if (fs.existsSync(target)) {
      const st = fs.statSync(target)
      if (!st.isDirectory()) return { ok: false, reason: 'exists-not-dir' }
      return { ok: true, path: target, existed: true }
    }
    fs.mkdirSync(target, { recursive: true })
    return { ok: true, path: target, existed: false }
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err?.message || err) }
  }
})

ipcMain.handle('list-files', async (_, folderPath) => {
  const fs = require('fs')
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    return entries
      .filter(e => !e.name.startsWith('.'))
      .slice(0, 50)
      .map(e => ({ name: e.name, isDir: e.isDirectory() }))
  } catch {
    return []
  }
})

// Workspace tree: returns up to `maxEntries` files+dirs with sizes, skipping
// heavy noise directories. Used by the sidebar File Browser.
const WORKSPACE_IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache',
  'target', '.gradle', '.idea', '.vscode', '.cache', '.DS_Store',
])
ipcMain.handle('workspace-list', async (_, folderPath) => {
  const fs = require('fs')
  const p = require('path')
  if (!folderPath) return { error: 'no-folder' }
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    const out = []
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue
      if (WORKSPACE_IGNORE.has(e.name)) continue
      const full = p.join(folderPath, e.name)
      let size = 0
      try {
        if (!e.isDirectory()) size = fs.statSync(full).size
      } catch {}
      out.push({ name: e.name, isDir: e.isDirectory(), size, path: full })
    }
    // Sort: dirs first, then alphabetically
    out.sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1))
    return { entries: out.slice(0, 200) }
  } catch (err) {
    return { error: err.message || 'read-failed' }
  }
})

ipcMain.handle('open-external', async (_, url) => {
  shell.openExternal(url)
})

// ── Menu Bar Ambient (Tray + Quick Window) ────────────────────────────────
// A small always-available "⚡ Labaik Quick" panel that lives in the macOS
// menu bar. Lets the user ask a question and get an answer without
// switching windows. Same chat IPC as the main app, but a minimal UI.

function createQuickWindow() {
  if (quickWindow) return quickWindow
  quickWindow = new BrowserWindow({
    width: 360,
    height: 420,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    alwaysOnTop: true,
    fullscreenable: false,
    transparent: false,
    backgroundColor: '#1a1a1a',
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-quick.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  quickWindow.loadFile(path.join(__dirname, '..', 'renderer', 'quick.html'))
  // Hide on blur so clicking elsewhere makes it disappear — standard
  // menu-bar popover behavior.
  quickWindow.on('blur', () => {
    if (quickWindow && quickWindow.isVisible()) quickWindow.hide()
  })
  quickWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) shell.openExternal(url)
    return { action: 'deny' }
  })
  return quickWindow
}

function positionQuickWindow() {
  if (!quickWindow || !tray) return
  const trayBounds = tray.getBounds()
  const winBounds = quickWindow.getBounds()
  // Center the window beneath the tray icon; clamp to screen.
  const display = screen.getDisplayMatching(trayBounds)
  const workArea = display.workArea
  let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (winBounds.width / 2))
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - winBounds.width - 8))
  const y = process.platform === 'darwin' ? trayBounds.y + trayBounds.height + 4 : trayBounds.y - winBounds.height - 4
  quickWindow.setPosition(x, Math.max(y, workArea.y + 4), false)
}

function toggleQuickWindow() {
  createQuickWindow()
  if (quickWindow.isVisible()) {
    quickWindow.hide()
  } else {
    positionQuickWindow()
    quickWindow.show()
    quickWindow.focus()
    quickWindow.webContents.send('quick-show')
  }
}

function createTray() {
  if (tray) return
  // Build a 16×16 template icon so macOS handles dark/light-mode colors.
  const iconPath = path.join(__dirname, '..', 'build', 'icons', 'icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)  // macOS will auto-tint to match the menu bar
  } catch (err) {
    // Fallback: tiny empty image if the icon load fails
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  tray.setToolTip('Labaik Quick — ⌘⇧A to toggle')
  tray.on('click', () => toggleQuickWindow())
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Ask Labaik…', click: () => toggleQuickWindow() },
      { type: 'separator' },
      { label: 'Open Labaik (full)', click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        else mainWindow.show()
      }},
      { type: 'separator' },
      { label: 'Quit Labaik', click: () => app.quit() },
    ])
    tray.popUpContextMenu(menu)
  })
}

// IPC handlers for the quick window
ipcMain.handle('quick-hide', () => { if (quickWindow) quickWindow.hide() })
ipcMain.handle('quick-open-main', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else { mainWindow.show(); mainWindow.focus() }
  if (quickWindow) quickWindow.hide()
})

// ── Menu ─────────────────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'Alaude',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-session') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/alaude-ai/alaude#readme') },
        { label: 'Website', click: () => shell.openExternal('https://alaude.ai') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  // Menu-bar ambient: tray + global shortcut ⌘⇧A to toggle the quick window.
  // Failure to create the tray (e.g. on headless CI) shouldn't crash the app.
  try { createTray() } catch (err) { console.warn('[tray] create failed:', err.message) }
  try {
    const accel = process.platform === 'darwin' ? 'Cmd+Shift+A' : 'Ctrl+Shift+A'
    globalShortcut.register(accel, toggleQuickWindow)
  } catch (err) { console.warn('[shortcut] register failed:', err.message) }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // v0.5.4: kick off the cron-skills scheduler. Fires due skills by running
  // a silent chat turn through the existing worker pipeline and notifying
  // the renderer so it can append the result into a dedicated skills session.
  // v0.5.6: Boot any configured MCP servers. Don't await — a slow server
  // shouldn't hold up the UI; its tools just appear once the handshake
  // completes. Errors surface as toasts via the mcp-status event.
  mcp.startAll().then(results => {
    try { mainWindow?.webContents?.send('mcp-ready', results) } catch {}
  }).catch(err => console.warn('[mcp] startAll failed:', err.message))

  try {
    skills.startScheduler(async (skill) => {
      const worker = getWorker()
      const id = ++requestId
      const messageId = `skill_${skill.id}_${Date.now()}`
      return new Promise((resolve) => {
        pendingRequests.set(id, {
          sender: mainWindow?.webContents,  // route any activity to main window
          resolve: (result) => {
            const preview = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 400)
            skills.recordRun(skill.id, { status: 'ok', resultPreview: preview })
            try { mainWindow?.webContents?.send('skill-ran', { skill, success: true, result }) } catch {}
            resolve()
          },
          reject: (err) => {
            skills.recordRun(skill.id, { status: 'error', resultPreview: String(err?.message || err).slice(0, 400) })
            try { mainWindow?.webContents?.send('skill-ran', { skill, success: false, error: String(err?.message || err) }) } catch {}
            resolve()
          },
        })
        const messagesRaw = [{ role: 'user', content: skill.prompt }]
        const mode = getCurrentMode(null) // skills run with global default mode
        const req = JSON.stringify({ id, messageId, messages: messagesRaw, model: skill.model || '', workspacePath: '', spacePrompt: '', mode }) + '\n'
        try { worker.stdin.write(req, 'utf8') } catch (err) {
          pendingRequests.delete(id)
          resolve()
        }
        // Shorter cap for skill runs — don't let a stuck skill block the queue.
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id)
            skills.recordRun(skill.id, { status: 'timeout', resultPreview: 'Skill timed out after 5 min' })
            try { mainWindow?.webContents?.send('skill-ran', { skill, success: false, error: 'Timed out' }) } catch {}
            resolve()
          }
        }, 5 * 60 * 1000)
      })
    })
  } catch (err) { console.warn('[skills] start failed:', err.message) }
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
