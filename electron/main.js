const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, globalShortcut, nativeImage, screen } = require('electron')
const path = require('path')
const os = require('os')
const http = require('http')
const crypto = require('crypto')
const ollama = require('./ollama')
const modelCatalog = require('./model-catalog')
const ooda = require('./ooda')

// Tiny duplicate of api-worker's detectProvider, so main can derive provider
// from a model string for telemetry without round-tripping through the worker.
function detectProviderForUx(model) {
  const s = (model || '').toLowerCase()
  if (s.startsWith('ollama/') || s.startsWith('gemma') || s.startsWith('qwen3') || s.startsWith('llama3') || s.startsWith('deepseek-r1') || s.includes(':')) return 'ollama'
  if (s.startsWith('gpt-') || s.startsWith('o1') || s.startsWith('o3') || s.startsWith('o4')) return 'openai'
  if (s.startsWith('grok-')) return 'xai'
  if (s.startsWith('moonshot-') || s.startsWith('kimi-')) return 'moonshot'
  if (s.startsWith('qwen-')) return 'dashscope'
  if (s.startsWith('glm-')) return 'zhipu'
  if (s.startsWith('gemini')) return 'google'
  return 'anthropic'
}

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
      process.stderr.write(`[renderer ${lvl}] ${message} (${source}:${line})\n`)
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

function getApiKey(provider) {
  const fs = require('fs')

  // Check env vars first
  const envMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    xai: 'XAI_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
  }
  const envKey = process.env[envMap[provider]]
  if (envKey) return envKey

  // Try multiple credential file locations
  const configDirs = [
    path.join(os.homedir(), '.claude'),
    path.join(os.homedir(), 'claude-local-src'),
  ]

  for (const dir of configDirs) {
    try {
      const credPath = path.join(dir, '.credentials.json')
      if (fs.existsSync(credPath)) {
        const data = JSON.parse(fs.readFileSync(credPath, 'utf8'))
        const key = data?.providerApiKeys?.[provider]
        if (key) return key
      }
    } catch {}
  }

  return null
}

function detectProvider(model) {
  const m = (model || '').toLowerCase()
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai'
  if (m.startsWith('grok-')) return 'xai'
  if (m.startsWith('moonshot-') || m.startsWith('kimi-')) return 'moonshot'
  if (m.startsWith('qwen-')) return 'dashscope'
  if (m.startsWith('glm-')) return 'zhipu'
  if (m.startsWith('gemini')) return 'google'
  return 'anthropic'
}

function getBaseURL(provider) {
  const urls = {
    openai: undefined, // default
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  }
  return urls[provider]
}

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

        // Save the token as the Anthropic API key
        saveCredential('anthropic', accessToken)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f5f5f5"><h2 style="color:#00a846">Logged in!</h2><p>You can close this window and return to Alaude.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>')
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

function saveCredential(provider, key) {
  const fs = require('fs')
  const configDir = path.join(os.homedir(), '.claude')
  const credPath = path.join(configDir, '.credentials.json')

  let data = {}
  try {
    if (fs.existsSync(credPath)) {
      data = JSON.parse(fs.readFileSync(credPath, 'utf8'))
    }
  } catch {}

  if (!data.providerApiKeys) data.providerApiKeys = {}
  data.providerApiKeys[provider] = key

  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(credPath, JSON.stringify(data, null, 2), { mode: 0o600 })
}

// ── IPC: Chat ────────────────────────────────────────────────────────────────

// ── API Worker (runs in plain Node.js to avoid Electron network issues) ──────

const { spawn: spawnChild } = require('child_process')
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
          try { mainWindow?.webContents?.send('tool-activity', resp.activity) } catch {}
          try { if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) quickWindow.webContents.send('tool-activity', resp.activity) } catch {}
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

ipcMain.handle('chat', async (_, messagesRaw, model, workspacePath, spaceId, uxMeta) => {
  const id = ++requestId
  const worker = getWorker()

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
    pendingRequests.set(id, {
      resolve: (result) => { finalize(true, null, String(result || '').length); resolve(result) },
      reject: (err) => { finalize(false, err); reject(err) },
    })
    const req = JSON.stringify({ id, messageId, messages: messagesRaw, model, workspacePath, spacePrompt }) + '\n'
    console.log('[chat] sending to worker, id:', id, 'space:', spaceId || 'general')
    worker.stdin.write(req, 'utf8')

    // Per-provider timeouts. Local models (Ollama) need room to (a) load
    // multi-GB weights into RAM on the first call and (b) generate long
    // responses on slower hardware. Cloud models should fail fast so users
    // aren't stuck waiting on a dead API call.
    const isLocalModel = provider === 'ollama'
    const TIMEOUT_MS = isLocalModel ? 10 * 60 * 1000 : 2 * 60 * 1000
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        const mins = Math.round(TIMEOUT_MS / 60000)
        const err = new Error(`Request timed out (${mins} min). ${isLocalModel
          ? 'Local model may be loading weights or generating a long response — try a smaller model or a shorter prompt.'
          : 'Provider may be slow or unreachable.'}`)
        finalize(false, err)
        reject(err)
      }
    }, TIMEOUT_MS)
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
    ? `You are Alaude, an AI coding assistant. You have access to the user's workspace at: ${workspacePath}\n\nYou can read files, write files, list directories, and run shell commands. Use the provided tools to help the user. When writing code, always use write_file. Always explain what you're doing.`
    : 'You are Alaude, an AI coding assistant.'

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
    ? `You are Alaude, an AI coding assistant. You have access to the user's workspace at: ${workspacePath}\n\nYou can read files, write files, list directories, and run shell commands. Use the provided tools to help the user with coding tasks. When writing code, always use write_file to save it. When the user asks to see files, use read_file. Always explain what you're doing.`
    : 'You are Alaude, an AI coding assistant. Help the user with coding questions and tasks.'

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

// ── IPC: Key management ─────────────────────────────────────────────────────

ipcMain.handle('get-key-statuses', () => {
  const providers = ['anthropic', 'openai', 'google', 'xai', 'moonshot', 'dashscope', 'zhipu']
  const result = {}
  for (const p of providers) {
    const key = getApiKey(p)
    result[p] = key ? 'set' : 'none'
  }
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

ipcMain.handle('ollama-list', async () => ollama.listInstalled())

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
// A small always-available "⚡ Alaude Quick" panel that lives in the macOS
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
  tray.setToolTip('Alaude Quick — ⌘⇧A to toggle')
  tray.on('click', () => toggleQuickWindow())
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Ask Alaude…', click: () => toggleQuickWindow() },
      { type: 'separator' },
      { label: 'Open Alaude (full)', click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        else mainWindow.show()
      }},
      { type: 'separator' },
      { label: 'Quit Alaude', click: () => app.quit() },
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
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
