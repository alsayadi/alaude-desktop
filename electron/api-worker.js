/**
 * API Worker — runs in a plain Node.js child process to avoid Electron network issues.
 * Communicates via JSON lines on stdin/stdout.
 */
const fs = require('fs')
const _path = require('path')
// Ensure require resolves relative to this file's directory
const healthDir = _path.join(__dirname, 'health')
const path = require('path')
const os = require('os')
const dns = require('dns')
const https = require('https')

// v0.7.61 — provider routing moved into a shared registry so the worker
// and the main process agree on which provider a given model belongs to.
// Historically this was duplicated between api-worker.js and main.js and
// drifted whenever we added a new provider.
const {
  detectProvider,
  getBaseURL,
  normalizeModelId,
  ENV_MAP,
} = require('./provider-registry')

// ── v0.7.39 — Scope boundary check for shell commands ─────────────────
//
// Tools with `cwd: workspacePath` (run_command, start_dev_server) would
// otherwise be trivially bypassed by a command string that names an
// absolute path or `cd ..`s out of scope. This helper does a best-effort
// check:
//   1. Reject `cd ..` / `cd /absolute` patterns
//   2. Reject absolute paths (start with /) that resolve outside workspace
//      UNLESS they point to system-neutral dirs like /tmp, /usr, /etc,
//      /var, /bin, /opt, /Library (read-only system locations are fine for
//      most tool invocations — e.g. `cp /tmp/foo .` is legit).
// Returns { ok: true } or { ok: false, reason: string }.
function checkCommandScope(command, workspacePath) {
  if (!command || !workspacePath) return { ok: true }
  const root = path.resolve(workspacePath)
  // 1. cd escape attempts
  if (/\bcd\s+(?:\.\.(?:\/|$|\s)|\/)/i.test(command)) {
    return { ok: false, reason: '`cd ..` or `cd /` attempts to escape the scope' }
  }
  // 2. Absolute path mentions. Extract anything that starts with `/` preceded
  //    by word boundary or quote/space. Ignore URLs (http://) and system dirs.
  const systemDirs = ['/tmp', '/usr', '/etc', '/var', '/bin', '/sbin', '/opt', '/Library', '/System', '/dev', '/private']
  const absMatches = [...command.matchAll(/(?:^|[\s'"`;|&()<>])(\/(?:[^\s'"`;|&()<>]|\\ )+)/g)]
  for (const m of absMatches) {
    const p = m[1]
    // URL fragments like /api/foo after a hostname — ignore (caller's tool should have validated)
    if (p.match(/^\/\w+:\/\//)) continue
    // System dirs are always fine
    if (systemDirs.some(d => p === d || p.startsWith(d + '/'))) continue
    // Resolve and check containment
    let resolved
    try { resolved = path.resolve(p) } catch { continue }
    if (resolved === root || resolved.startsWith(root + path.sep)) continue
    return { ok: false, reason: `absolute path ${p} is outside ${workspacePath}` }
  }
  return { ok: true }
}

// ── Crash handlers ─────────────────────────────────────────────────────────
// The worker is a request loop serving one chat at a time. A single bad
// request (e.g. the OpenAI SDK emits a sync `error` event inside a stream
// iterator that nothing else listens to) should NOT take the whole process
// down — next request should just work. We log the stack for diagnostics
// and fire any in-flight request's reject path so the renderer sees an
// error promptly instead of waiting 30s for the parent-process's `exit`
// handler to notice a dead worker.
let _inFlightRequest = null  // { id, rejectOnCrash } — set when handleChat starts
process.on('uncaughtException', (err) => {
  try { process.stderr.write(`[worker] uncaughtException (recovered): ${err?.stack || err}\n`) } catch {}
  if (_inFlightRequest?.id != null) {
    try { process.stdout.write(JSON.stringify({ id: _inFlightRequest.id, error: String(err?.message || err) }) + '\n') } catch {}
    _inFlightRequest = null
  }
  // Do NOT exit — the loop can accept new work.
})
process.on('unhandledRejection', (err) => {
  try { process.stderr.write(`[worker] unhandledRejection: ${err?.stack || err}\n`) } catch {}
  if (_inFlightRequest?.id != null) {
    try { process.stdout.write(JSON.stringify({ id: _inFlightRequest.id, error: String(err?.message || err) }) + '\n') } catch {}
    _inFlightRequest = null
  }
})

// ── Resilient DNS resolver ──────────────────────────────────────────────────
// VPN tools (e.g. Astrill) need DNS to go through their server to set up routing.
// We try system DNS first (so VPN routing works), then fall back to public DNS.
const publicResolver = new dns.Resolver()
publicResolver.setServers(['8.8.8.8', '1.1.1.1'])

const _origLookup = dns.lookup
dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  if (typeof options === 'number') { options = { family: options } }

  // Try system DNS first (preserves VPN routing)
  const timeout = setTimeout(() => {
    process.stderr.write(`[dns] system DNS timed out for ${hostname}, trying public DNS\n`)
    publicResolver.resolve4(hostname, (err2, addresses) => {
      if (!err2 && addresses?.length) {
        process.stderr.write(`[dns] public DNS resolved ${hostname} -> ${addresses[0]}\n`)
        if (options.all) return callback(null, addresses.map(a => ({ address: a, family: 4 })))
        return callback(null, addresses[0], 4)
      }
      callback(err2 || new Error(`DNS resolution failed for ${hostname}`))
    })
  }, 3000)

  _origLookup.call(dns, hostname, options, (err, ...args) => {
    clearTimeout(timeout)
    if (!err) {
      process.stderr.write(`[dns] system DNS resolved ${hostname}\n`)
      return callback(null, ...args)
    }
    process.stderr.write(`[dns] system DNS failed for ${hostname}: ${err.message}, trying public DNS\n`)
    publicResolver.resolve4(hostname, (err2, addresses) => {
      if (!err2 && addresses?.length) {
        process.stderr.write(`[dns] public DNS resolved ${hostname} -> ${addresses[0]}\n`)
        if (options.all) return callback(null, addresses.map(a => ({ address: a, family: 4 })))
        return callback(null, addresses[0], 4)
      }
      callback(err2 || err)
    })
  })
}

// Returns { value, isOauth } | null.
// OAuth tokens (Bearer) beat API keys (x-api-key) if both are present.
function getCredential(provider) {
  if (provider === 'ollama') return { value: 'ollama', isOauth: false }
  // v0.7.64: credentials now live at ~/.labaik/credentials.json. We keep
  // reading from ~/.claude/.credentials.json (legacy) and the dev
  // `claude-local-src/` fallback so existing users don't lose access —
  // main.js writes to the new location on any set-key, which takes over.
  const credPaths = [
    path.join(os.homedir(), '.labaik', 'credentials.json'),
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
      if (apiKey) {
        // Migration: pre-v0.2.73 stored OAuth tokens under providerApiKeys.
        // Anthropic OAuth access tokens have the distinctive "sk-ant-oat" prefix.
        if (provider === 'anthropic' && typeof apiKey === 'string' && apiKey.startsWith('sk-ant-oat')) {
          return { value: apiKey, isOauth: true }
        }
        return { value: apiKey, isOauth: false }
      }
    } catch {}
  }
  // Env var fallback — derived from the shared provider registry so new
  // providers get free env-var discovery as soon as they're added there.
  const envKey = process.env[ENV_MAP[provider]]
  if (envKey) return { value: envKey, isOauth: false }
  return null
}

function getApiKey(provider) {
  const c = getCredential(provider)
  return c ? c.value : null
}

// v0.7.61: `getBaseURL`, `detectProvider`, and the old
// `normalizeOllamaModel` helper now live in `provider-registry.js`.
// `normalizeModelId` supersedes `normalizeOllamaModel` — it strips any
// provider-specific routing prefix (Ollama's `ollama/`, Kimi global's
// `kimi-intl/`, etc.) in one go.

/**
 * Only skip tools for genuinely tiny / unreliable local models. Every modern
 * mid-to-large open-weight model supports OpenAI-style function calling fine.
 */
function shouldSkipToolsForLocal(model) {
  const m = normalizeModelId(model).toLowerCase()
  // Known-poor tool callers at their smallest sizes
  if (m.startsWith('gemma3:1b')) return true
  if (m.startsWith('llama3.2:1b')) return true
  if (m.startsWith('llama3.2:3b')) return true
  // DeepSeek R1 distills wrap their output in <think> tags and often mis-format tool calls
  if (m.startsWith('deepseek-r1')) return true
  return false
}

// ─── System-prompt builder ─────────────────────────────────────────────────
// The old unconditional primer was ~500 tokens and got shipped with every
// turn regardless of user intent. Prompt-eval on that is ~1s on local models
// and a measurable chunk of cloud latency on small prompts. This builder
// assembles a *minimal* prompt for plain-prose questions and adds only the
// rich-block docs the user's message actually hints at.
const RICH_BLOCK_DOCS = {
  chart:     '• ```chart JSON → inline SVG. Shape: {"type":"bar|line|pie|area|donut","title":"...","data":{"labels":[...],"values":[...]}}',
  mermaid:   '• ```mermaid → flowchart / sequence / class / gantt / ER.',
  svg:       '• ```svg → raw <svg> for custom illustrations.',
  html:      '• ```html (or ```artifact) → standalone HTML + JS + CSS, sandboxed iframe. Include everything inline.',
  pptx:      '• ```pptx → .pptx file. Shape: {"title":"...","subtitle":"...","slides":[{"title":"...","bullets":["..."],"body":"...","notes":"..."}]}',
  docx:      '• ```docx → .docx file. Shape: {"title":"...","sections":[{"heading":"...","level":1,"body":"...","bullets":["..."]}]}',
  xlsx:      '• ```xlsx → .xlsx file. Shape: {"title":"...","sheets":[{"name":"...","rows":[["H1","H2"],[1,2]]}]}',
  pythonrun: '• ```python-run → executable Python in the user\'s chat (Pyodide). Use print() for output. Has numpy/pandas/matplotlib on demand. Great for calculations, data analysis, quick plots. Runs in a sandbox — no network, no filesystem.',
  jsrun:     '• ```js-run → executable JavaScript in the user\'s chat. Use console.log() for output. Return a value as the last expression to see it. Great for quick scripts, JSON manipulation, API-shape exploration.',
}
const RICH_BLOCK_KEYWORDS = {
  chart:     /\b(chart|graph|plot|bar\s*chart|pie\s*chart|line\s*chart|donut|visuali[sz]e|chart\s*of)\b/i,
  mermaid:   /\b(diagram|flow(chart)?|sequence\s*diagram|gantt|class\s*diagram|er\s*diagram|architecture\s*diagram)\b/i,
  svg:       /\b(svg|illustration|icon|draw\s*(a|an|me))\b/i,
  html:      /\b(game|playable|interactive|widget|canvas|demo|animation|simulation|typing\s*test|run\s*it)\b/i,
  pptx:      /\b(slides?|deck|presentation|powerpoint|pptx)\b/i,
  docx:      /\b(document|report|write[- ]?up|brief|memo|docx|word\s*doc)\b/i,
  xlsx:      /\b(spreadsheet|excel|workbook|xlsx|roster|budget|table\s*of\s*(data|numbers))\b/i,
  pythonrun: /\b(python|pandas|numpy|matplotlib|calculate|compute|simulate|crunch|fibonacci|prime|data\s*analysis)\b/i,
  jsrun:     /\b(javascript|json|parse|regex|transform|format|js\b)\b/i,
}

/**
 * Decide which rich-output blocks to advertise based on the user's latest turn.
 * Returns an array of block keys to include; empty = user wants plain prose.
 */
function detectRichIntent(userText) {
  const keys = []
  const t = String(userText || '')
  if (!t) return keys
  for (const [key, re] of Object.entries(RICH_BLOCK_KEYWORDS)) {
    if (re.test(t)) keys.push(key)
  }
  return keys
}

// v0.7.67 — AGENTS.md / CLAUDE.md auto-injection.
//
// When the workspace contains an AGENTS.md (vendor-neutral convention) or
// CLAUDE.md (Anthropic's convention) at its root, append its contents to the
// system prompt so project-specific instructions reach the model on every
// turn — no separate pasting, no settings UI to maintain.
//
// Precedence: AGENTS.md > CLAUDE.md > .agents.md > .claude.md. First hit wins.
// Capped at 16KB so a 200KB README accidentally renamed AGENTS.md doesn't
// blow up the context window. Truncation marker tells the model + the user
// what happened.
//
// Read fresh on every chat turn (no cache) so the user can edit the file
// and see the change take effect on the next message. Files are tiny
// (single-digit KB typically) — re-reading is cheaper than cache invalidation.
const AGENTS_MD_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', '.agents.md', '.claude.md']
const AGENTS_MD_MAX_BYTES = 16 * 1024

function loadProjectInstructions(workspacePath) {
  if (!workspacePath) return null
  for (const name of AGENTS_MD_CANDIDATES) {
    const fp = path.join(workspacePath, name)
    try {
      const stat = fs.statSync(fp)
      if (!stat.isFile()) continue
      let text = fs.readFileSync(fp, 'utf8')
      const originalLen = text.length
      if (text.length > AGENTS_MD_MAX_BYTES) {
        text = text.slice(0, AGENTS_MD_MAX_BYTES) +
          `\n\n[…truncated ${originalLen - AGENTS_MD_MAX_BYTES} chars on inject — keep ${name} under ${AGENTS_MD_MAX_BYTES / 1024}KB for full context]`
      }
      return { name, text, bytes: originalLen }
    } catch { /* not present, try next candidate */ }
  }
  return null
}

function buildSystemPrompt({ provider, model, workspacePath, spacePrompt, userText }) {
  let sys = 'You are Labaik, a helpful AI assistant.'
  // v0.7.42 — ambiguity nudge. Without this, a one-word prompt like "test"
  // got interpreted by the model as "run my tests" because of the workspace
  // + tools context. Tell the model to clarify instead of guessing.
  sys += ' If the user\'s message is vague or a single ambiguous word (e.g. "test", "fix", "go", "run"), ASK what they mean before touching any file or running any command. Don\'t assume workspace-related intent for every message.'
  if (workspacePath) {
    sys += ` Workspace: ${workspacePath}. Use tools to read/write files, list dirs, run commands. Always explain what you do.`
    // v0.7.38 — hard boundary hint. The renderer may pass a task-scope
    // subfolder here instead of the real workspace root; the model should
    // treat this path as its entire universe, not reach ../ or absolute
    // paths to escape. Worker-level containedPath() enforces this for
    // read_file/write_file/list_directory; the prompt exists to stop the
    // model from using absolute paths in run_command/open_in_browser.
    sys += ` IMPORTANT: All file operations — reads, writes, shell commands, browser opens — must stay inside ${workspacePath}. Use relative paths, not absolute paths. If a file you need isn't in this directory, tell the user it's missing; do NOT reach up into parent folders or use absolute paths to find it.`
    // v0.7.38 — python3 vs python. On modern macOS, only `python3` is
    // installed by default. The model often reaches for `python` which
    // fails with ENOENT. Tell it up front.
    sys += ` When running Python, use \`python3\` (not \`python\`) — plain \`python\` is not installed on modern macOS.`
  }
  // Local models: stay quiet unless the user clearly wants a rich block. Small
  // open-weight models process every token slowly, and they often ignore the
  // primer anyway. This single change recovered the ~15× local-speed gap
  // measured between direct Ollama and Alaude in testing.
  const isLocal = provider === 'ollama'
  const intent = detectRichIntent(userText)
  if (intent.length) {
    sys += '\n\nRich output — use these fenced blocks when the user asks for visuals / files. No preamble before the block.\n'
    for (const k of intent) sys += RICH_BLOCK_DOCS[k] + '\n'
    sys += '- Always emit valid JSON inside the block.\n- Prefer inline (chart/mermaid/svg) over a downloadable file unless the user asked to "download" or "export".'
  } else if (!isLocal) {
    // Cloud models get a tiny one-liner — cheap enough, reminds them the
    // rich blocks exist for follow-up turns in the same session.
    sys += '\n\nLabaik renders chart / mermaid / svg / html / pptx / docx / xlsx fenced blocks when the user asks for visuals or exports.'
  }
  // v0.7.67 — inject project instructions from AGENTS.md / CLAUDE.md if present.
  // Goes BEFORE the space prompt so the user's space-level system prompt can
  // override or extend the project's defaults if they conflict.
  if (workspacePath) {
    const proj = loadProjectInstructions(workspacePath)
    if (proj) {
      sys += `\n\n## Project instructions (from ${proj.name})\n\n${proj.text}`
      try { console.error(`[worker] Injected ${proj.name} (${proj.bytes} bytes) from ${workspacePath}`) } catch {}
    }
  }
  if (spacePrompt) sys += '\n\n' + spacePrompt
  return sys
}

// Heuristic: which local (Ollama) models default to emitting reasoning tokens
// we'd rather skip. These models generate hundreds of hidden "thinking"
// tokens before the actual answer, which Alaude can't display (only
// delta.content is captured) — so the user sees a spinner for 30+ seconds.
// We suppress reasoning via Ollama's `chat_template_kwargs: enable_thinking:
// false` which maps through to Qwen's own prompt template. Measured cut:
// 700 tokens → 165 tokens on a 36B Qwen 3 MoE ("hi" answer). Users who
// WANT reasoning can flip modes in a future "Reasoning" space override.
function isThinkingLocalModel(model) {
  const m = (model || '').toLowerCase().replace(/^ollama\//, '')
  if (m.startsWith('qwen3:') || m.startsWith('qwen3.')) return true
  if (m.startsWith('deepseek-r1')) return true  // DeepSeek R1 wraps answer in <think>
  if (m.startsWith('qwq')) return true  // Qwen QwQ reasoning family
  return false
}

const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'Read file contents (relative to workspace)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write content to a file (creates dirs if needed)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'list_directory', description: 'List files in directory', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Run shell command in workspace', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'open_in_browser', description: 'Open a URL or local file in the default browser (Chrome). Use for previewing HTML files, opening localhost dev servers, etc.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL or file path to open (e.g. "http://localhost:3000" or "index.html")' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'start_dev_server', description: 'Start a dev server in the background (npm run dev, python -m http.server, etc). Returns the process ID. The server keeps running.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to start the server (e.g. "npm run dev")' }, port: { type: 'number', description: 'Expected port number (e.g. 3000)' } }, required: ['command'] } } },
]

// ── Screen Control tools (v0.5.10) ────────────────────────────────────────
// Paired with Screen Vision: the model sees a screenshot, then clicks /
// types / hits keys on the actual desktop. Tool implementations live in
// main process (electron/screen-control.js) because they shell out to
// cliclick / osascript. Schemas below mirror those; keep in sync.
const SCREEN_TOOLS = [
  { type: 'function', function: { name: 'screen_click', description: 'Click a screen coordinate (x, y in pixels from top-left of the main display). Use after a screenshot to operate the active app on macOS.', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right'] } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'screen_type', description: 'Type text into whatever has keyboard focus on the screen. Works system-wide — Slack, Xcode, anywhere.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'screen_key', description: 'Send a keyboard combo system-wide (e.g. "cmd+c", "escape", "return", "cmd+shift+t"). Use for shortcuts and modal dismissal.', parameters: { type: 'object', properties: { combo: { type: 'string' } }, required: ['combo'] } } },
  { type: 'function', function: { name: 'screen_move_mouse', description: 'Move the mouse cursor to a screen coordinate without clicking (for hover-triggered UI).', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
]

// ── Browser Agent tools (v0.5.5) ──────────────────────────────────────────
// Schemas are inlined here because the worker is a plain Node process and
// can't import browser-agent.js (it pulls Electron BrowserWindow). Main
// reads its own copy via `require('./browser-agent').TOOLS`; the two must
// match. Keep them in sync if you edit one.
const BROWSER_TOOLS = [
  { type: 'function', function: { name: 'browser_navigate', description: 'Open or navigate a Chromium browser window to the given URL. Only http(s) allowed. Returns the final URL (after redirects) and the page title.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browser_get_text', description: 'Read the text content of the current page, or of a specific CSS selector. Returns up to 20,000 characters.', parameters: { type: 'object', properties: { selector: { type: 'string' } } } } },
  { type: 'function', function: { name: 'browser_click', description: 'Click an element in the current page (buttons, links). Selector must be a CSS query.', parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } } },
  { type: 'function', function: { name: 'browser_fill', description: 'Type into an input / textarea / contenteditable element. Fires input + change events so frameworks pick up the value.', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] } } },
  { type: 'function', function: { name: 'browser_screenshot', description: 'Capture the current browser window as a PNG. Returns base64 + mime. Use for debugging or visual verification.', parameters: { type: 'object', properties: {} } } },
]

// ── Health-Specific Tools ──────────────────────────────────────────────────

const HEALTH_TOOLS = [
  { type: 'function', function: { name: 'analyze_lab_result', description: 'Analyze a lab test result against reference ranges. Returns status (normal/high/low/critical), reference range, and clinical meaning.', parameters: { type: 'object', properties: { test_name: { type: 'string', description: 'Lab test name (e.g. "hemoglobin", "TSH", "glucose", "LDL", "HbA1c")' }, value: { type: 'number', description: 'The numeric result value' }, sex: { type: 'string', enum: ['male', 'female'], description: 'Patient sex (for sex-specific ranges)' } }, required: ['test_name', 'value'] } } },
  { type: 'function', function: { name: 'check_drug_interactions', description: 'Check for interactions between medications using the NIH RxNorm database. Enter 2 or more drug names.', parameters: { type: 'object', properties: { drugs: { type: 'array', items: { type: 'string' }, description: 'List of drug names (e.g. ["aspirin", "warfarin", "lisinopril"])' } }, required: ['drugs'] } } },
  { type: 'function', function: { name: 'health_calculator', description: 'Calculate health metrics: BMI, BMR, TDEE, macros, water intake, heart rate zones, body fat %, ideal weight.', parameters: { type: 'object', properties: { calculator: { type: 'string', enum: ['bmi', 'bmr', 'tdee', 'macros', 'water', 'heart_rate_zones', 'body_fat', 'ideal_weight'], description: 'Which calculator to use' }, weight_kg: { type: 'number' }, height_cm: { type: 'number' }, age: { type: 'number' }, sex: { type: 'string', enum: ['male', 'female'] }, activity_level: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'veryActive'] }, goal: { type: 'string', enum: ['lose', 'maintain', 'gain'] }, diet_preference: { type: 'string', enum: ['balanced', 'high_protein', 'low_carb', 'keto'] }, resting_hr: { type: 'number' }, waist_cm: { type: 'number' }, neck_cm: { type: 'number' }, hip_cm: { type: 'number' } }, required: ['calculator'] } } },
  { type: 'function', function: { name: 'score_phq9', description: 'Score a PHQ-9 depression screening questionnaire. Provide 9 responses (0-3 each). CRITICAL: If Question 9 (self-harm) > 0, crisis resources are shown.', parameters: { type: 'object', properties: { responses: { type: 'array', items: { type: 'number' }, description: '9 responses, each 0-3. (0=Not at all, 1=Several days, 2=More than half the days, 3=Nearly every day)' } }, required: ['responses'] } } },
  { type: 'function', function: { name: 'score_gad7', description: 'Score a GAD-7 anxiety screening questionnaire. Provide 7 responses (0-3 each).', parameters: { type: 'object', properties: { responses: { type: 'array', items: { type: 'number' }, description: '7 responses, each 0-3. (0=Not at all, 1=Several days, 2=More than half the days, 3=Nearly every day)' } }, required: ['responses'] } } },
]

/**
 * Format health tool results as rich HTML cards (rendered by the chat UI).
 * These use a <!--HEALTH_CARD:...--> marker so the renderer can detect and style them.
 */
function formatHealthCard(toolName, args, result) {
  if (toolName === 'analyze_lab_result' && result && result.status) {
    const statusColors = {
      'critical-low': '#d32f2f', 'low': '#e65100', 'normal': '#2e7d32',
      'optimal': '#1565c0', 'high': '#e65100', 'critical-high': '#d32f2f'
    }
    const statusLabels = {
      'critical-low': 'CRITICAL LOW', 'low': 'LOW', 'normal': 'NORMAL',
      'optimal': 'OPTIMAL', 'high': 'HIGH', 'critical-high': 'CRITICAL HIGH'
    }
    const color = statusColors[result.status] || '#666'
    const label = statusLabels[result.status] || result.status
    const pct = result.referenceHigh && result.referenceLow
      ? Math.min(100, Math.max(0, ((result.value - result.referenceLow) / (result.referenceHigh - result.referenceLow)) * 100))
      : 50

    return `<!--HEALTH_CARD-->
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:8px 0;font-family:system-ui">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div>
      <div style="font-size:13px;color:#666">${result.test.category} — ${result.test.loincCode}</div>
      <div style="font-size:18px;font-weight:700">${result.test.name}</div>
    </div>
    <div style="background:${color};color:#fff;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600">${label}</div>
  </div>
  <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:12px">
    <span style="font-size:32px;font-weight:700;color:${color}">${result.value}</span>
    <span style="font-size:14px;color:#666">${result.unit}</span>
  </div>
  <div style="background:#f0f0f0;border-radius:6px;height:8px;position:relative;margin-bottom:8px">
    <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:6px;transition:width 0.3s"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#999;margin-bottom:12px">
    <span>${result.referenceLow != null ? result.referenceLow : ''}</span>
    <span>Reference Range</span>
    <span>${result.referenceHigh != null ? result.referenceHigh : ''}</span>
  </div>
  <div style="font-size:13px;color:#444;line-height:1.5;padding:10px;background:#f8f8f8;border-radius:8px">
    <div style="font-weight:600;margin-bottom:4px">What this means:</div>
    ${result.test.meaning}
  </div>
  <div style="font-size:12px;color:#999;margin-top:8px">📋 ${result.test.description}</div>
</div><!--/HEALTH_CARD-->`
  }

  if (toolName === 'check_drug_interactions' && result && result.interactions) {
    if (result.interactions.length === 0) {
      return `<!--HEALTH_CARD-->
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:8px 0;font-family:system-ui">
  <div style="font-size:18px;font-weight:700;margin-bottom:8px">💊 Drug Interaction Check</div>
  <div style="color:#2e7d32;font-weight:600">✅ No interactions found between ${result.medications.map(m => m.resolved).join(', ')}</div>
</div><!--/HEALTH_CARD-->`
    }

    const cards = result.interactions.map(i => {
      const info = i.severityInfo || {}
      return `<div style="border-left:4px solid ${info.color || '#666'};padding:8px 12px;margin:6px 0;background:#f8f8f8;border-radius:0 8px 8px 0">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
    <span style="font-size:14px">${info.emoji || '⚠️'}</span>
    <span style="font-weight:700;color:${info.color || '#666'}">${info.label || i.severity}</span>
    <span style="color:#666;font-size:13px">— ${i.drug1.name} + ${i.drug2.name}</span>
  </div>
  <div style="font-size:13px;color:#444">${i.description}</div>
  <div style="font-size:11px;color:#999;margin-top:4px">Source: ${i.source}</div>
</div>`
    }).join('')

    return `<!--HEALTH_CARD-->
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:8px 0;font-family:system-ui">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px">💊 Drug Interaction Check</div>
  <div style="font-size:13px;color:#666;margin-bottom:8px">Checked: ${result.medications.map(m => m.resolved).join(', ')}</div>
  ${cards}
</div><!--/HEALTH_CARD-->`
  }

  if (toolName === 'health_calculator' && result) {
    if (result.value != null && result.category) {
      // BMI result
      return `<!--HEALTH_CARD-->
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:8px 0;font-family:system-ui">
  <div style="font-size:18px;font-weight:700;margin-bottom:8px">📊 BMI Calculator</div>
  <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px">
    <span style="font-size:36px;font-weight:700;color:${result.category.color}">${result.value}</span>
    <span style="font-size:14px;color:#666">kg/m²</span>
  </div>
  <div style="font-size:15px;font-weight:600;color:${result.category.color}">${result.category.label}</div>
  <div style="font-size:12px;color:#999;margin-top:8px">Healthy weight range: ${result.healthyWeightRange.low} – ${result.healthyWeightRange.high} kg</div>
</div><!--/HEALTH_CARD-->`
    }
  }

  return null // No special formatting — use default
}

async function executeToolCall(name, args, workspacePath, mode = 'autopilot') {
  const { execSync } = require('child_process')
  // v0.4.0: Observe mode is read-only. The gate here lives alongside the
  // existing containedPath guards so a wrong mode can't slip past. More
  // granular gates (prompt / allow-list / rule resolution) arrive with the
  // approval IPC in v0.4.1+.
  const WRITE_TOOLS = new Set(['write_file', 'run_command', 'open_in_browser', 'start_dev_server',
    'browser_navigate', 'browser_click', 'browser_fill',
    'screen_click', 'screen_type', 'screen_key', 'screen_move_mouse'])
  if (mode === 'observe' && WRITE_TOOLS.has(name)) {
    return { error: `Observe mode is read-only. Switch to Careful, Flow, or Autopilot (Shift+Tab) to enable ${name}.` }
  }

  // v0.5.5: Browser Agent — tool runs in main via IPC. All browser_* tools
  // route through the same bridge; main dispatches by name.
  if (name.startsWith('browser_')) {
    return await requestBrowserTool(name, args || {})
  }
  // v0.5.6: MCP tools — names are mcp_<server>__<tool>. Route to main.
  if (name.startsWith('mcp_')) {
    return await requestMcpTool(name, args || {})
  }
  // v0.5.10: Screen control tools — click / type / key / move. Route to main.
  if (name.startsWith('screen_')) {
    return await requestScreenTool(name, args || {})
  }

  try {
    // ── Health tools (no workspace required) ──
    if (name === 'analyze_lab_result') {
      const { findTestByName, scoreLabResult } = require(_path.join(healthDir, 'lab-reference-db.js'))
      const test = findTestByName(args.test_name)
      if (!test) return { error: `Unknown lab test: "${args.test_name}". Try common names like hemoglobin, glucose, TSH, LDL, HbA1c, etc.` }
      return scoreLabResult(test.id, args.value, args.sex || 'any')
    }
    if (name === 'check_drug_interactions') {
      const { checkDrugInteractions, SEVERITY_INFO } = require(_path.join(healthDir, 'drug-client.js'))
      const result = await checkDrugInteractions(args.drugs)
      result.interactions = result.interactions.map(i => ({ ...i, severityInfo: SEVERITY_INFO[i.severity] || SEVERITY_INFO.unknown }))
      return result
    }
    if (name === 'health_calculator') {
      const calc = require(_path.join(healthDir, 'calculators.js'))
      switch (args.calculator) {
        case 'bmi': return calc.calculateBMI(args.weight_kg, args.height_cm)
        case 'bmr': return { bmr: calc.calculateBMR(args.weight_kg, args.height_cm, args.age, args.sex) }
        case 'tdee': { const bmr = calc.calculateBMR(args.weight_kg, args.height_cm, args.age, args.sex); return { bmr, tdee: calc.calculateTDEE(bmr, args.activity_level || 'moderate') } }
        case 'macros': { const bmr = calc.calculateBMR(args.weight_kg, args.height_cm, args.age, args.sex); const tdee = calc.calculateTDEE(bmr, args.activity_level || 'moderate'); return calc.calculateMacros(tdee, args.goal || 'maintain', args.weight_kg, args.diet_preference || 'balanced') }
        case 'water': return calc.calculateWaterIntake(args.weight_kg, args.activity_level, 'temperate')
        case 'heart_rate_zones': return calc.calculateHeartRateZones(args.age, args.resting_hr)
        case 'body_fat': return calc.calculateBodyFat(args.sex, args.waist_cm, args.neck_cm, args.height_cm, args.hip_cm)
        case 'ideal_weight': return calc.calculateIdealWeight(args.height_cm, args.sex)
        default: return { error: `Unknown calculator: ${args.calculator}` }
      }
    }
    if (name === 'score_phq9') {
      const { scorePHQ9 } = require(_path.join(healthDir, 'mental-health.js'))
      return scorePHQ9(args.responses)
    }
    if (name === 'score_gad7') {
      const { scoreGAD7 } = require(_path.join(healthDir, 'mental-health.js'))
      return scoreGAD7(args.responses)
    }

    // ── Workspace tools (require workspace) ──
    if (!workspacePath) return { error: 'No workspace selected. Choose a folder first.' }
    // Sandbox: reject any path that escapes the workspace root (../ traversal, symlink jumps).
    const wsRoot = path.resolve(workspacePath)
    const containedPath = (rel) => {
      const fp = path.resolve(wsRoot, rel || '.')
      if (fp !== wsRoot && !fp.startsWith(wsRoot + path.sep)) return null
      return fp
    }
    if (name === 'read_file') {
      const fp = containedPath(args.path)
      if (!fp) return { error: `Path escapes workspace: ${args.path}` }
      return { content: fs.readFileSync(fp, 'utf8').slice(0, 50000) }
    }
    if (name === 'write_file') {
      const fp = containedPath(args.path)
      if (!fp) return { error: `Path escapes workspace: ${args.path}` }
      // Capture old content BEFORE writing so we can render a real diff
      let oldContent = null
      try { if (fs.existsSync(fp)) oldContent = fs.readFileSync(fp, 'utf8') } catch {}
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, args.content, 'utf8')
      return {
        success: true,
        path: args.path,
        oldContent: oldContent?.slice(0, 50000) ?? null,  // cap to keep IPC small
        newContent: String(args.content || '').slice(0, 50000),
        isNewFile: oldContent === null,
      }
    }
    if (name === 'list_directory') {
      const dp = containedPath(args.path || '.')
      if (!dp) return { error: `Path escapes workspace: ${args.path}` }
      const entries = fs.readdirSync(dp, { withFileTypes: true })
      return { entries: entries.filter(e => !e.name.startsWith('.')).slice(0, 100).map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') }
    }
    if (name === 'run_command') {
      // v0.7.39: reject commands that reference paths outside the current
      // scope. The command still runs with cwd=workspacePath, but the
      // command STRING itself can encode absolute paths (`python3 -m
      // http.server -d /other/path`) or cd-out-of-scope tricks that
      // bypass cwd. This check catches both.
      const scopeCheck = checkCommandScope(args.command, workspacePath)
      if (!scopeCheck.ok) return { error: `Blocked by scope: ${scopeCheck.reason}. Use relative paths inside ${workspacePath}.` }
      const out = execSync(args.command, { cwd: workspacePath, timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(os.homedir(), '.bun', 'bin')}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` } })
      return { output: out.slice(0, 20000) }
    }
    if (name === 'open_in_browser') {
      const url = args.url
      let target = url
      // v0.7.39: block absolute paths + file:// URLs outside scope.
      // http://, https://, and localhost URLs always pass — that's how
      // dev servers get opened. Relative paths resolve against workspace.
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.startsWith('file://')) {
          const fp = url.slice(7)
          const resolved = path.resolve(fp)
          const root = path.resolve(workspacePath)
          if (!resolved.startsWith(root + path.sep) && resolved !== root) {
            return { error: `Blocked by scope: file:// URL escapes ${workspacePath}` }
          }
          target = url
        } else if (url.startsWith('/')) {
          const resolved = path.resolve(url)
          const root = path.resolve(workspacePath)
          if (!resolved.startsWith(root + path.sep) && resolved !== root) {
            return { error: `Blocked by scope: absolute path ${url} is outside ${workspacePath}` }
          }
          target = resolved
        } else {
          // Relative path — resolve against workspace (already in scope)
          target = path.resolve(workspacePath, url)
        }
      }
      const { exec } = require('child_process')
      exec(`open "${target}"`) // macOS; use xdg-open on Linux, start on Windows
      return { success: true, opened: target }
    }

    if (name === 'start_dev_server') {
      // v0.7.39: same scope guard as run_command. A `python3 -m http.server`
      // cannot be tricked into serving a different directory via args.
      const scopeCheck = checkCommandScope(args.command, workspacePath)
      if (!scopeCheck.ok) return { error: `Blocked by scope: ${scopeCheck.reason}. Use relative paths inside ${workspacePath}.` }
      const { spawn } = require('child_process')
      const parts = args.command.split(' ')
      const child = spawn(parts[0], parts.slice(1), {
        cwd: workspacePath,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: `${path.join(os.homedir(), '.bun', 'bin')}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` },
      })
      child.unref()
      const port = args.port || 3000
      // v0.7.40: report the PID back up to main.js so it can track the
      // server and kill it on session end / window close. Worker talks to
      // main via stdout JSON lines, not IPC.
      try { process.stdout.write(JSON.stringify({ type: 'server_started', pid: child.pid, port, command: args.command, workspacePath }) + '\n') } catch {}
      return { success: true, pid: child.pid, message: `Server started (PID ${child.pid}). Open http://localhost:${port}` }
    }

    return { error: `Unknown tool: ${name}` }
  } catch (err) { return { error: err.message } }
}

/**
 * Emit a live activity event back to the main process. These are in-flight
 * progress pings during a chat — the final `{id, result}` still follows.
 * Main.js forwards them to the renderer as `tool-activity`.
 */
function emitActivity(id, activity) {
  try { process.stdout.write(JSON.stringify({ id, activity }) + '\n') } catch {}
}

// v0.5.5/0.5.6: Bridges for tools that live in main (browser agent &
// MCP servers). Worker writes a request line to stdout, main runs the
// tool, writes response back to stdin. Each request has a unique id.
const _pendingBrowserTools = new Map()
const _pendingMcpCalls = new Map()
const _pendingMcpLists = new Map()
const _pendingScreenTools = new Map()

function _bridge(map, type, extra = {}) {
  const id = type.slice(0, 2) + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  try { process.stdout.write(JSON.stringify({ type, id, ...extra }) + '\n') } catch {}
  return new Promise((resolve) => {
    map.set(id, resolve)
    setTimeout(() => {
      if (map.has(id)) {
        map.delete(id)
        resolve({ error: `${type} timed out after 60s` })
      }
    }, 60000)
  })
}

function requestBrowserTool(name, args) {
  return _bridge(_pendingBrowserTools, 'browser-tool', { name, args })
}
function requestScreenTool(name, args) {
  return _bridge(_pendingScreenTools, 'screen-tool', { name, args })
}
function requestMcpTool(name, args) {
  return _bridge(_pendingMcpCalls, 'mcp-call', { name, args })
    .then(r => r && typeof r === 'object' && 'result' in r ? r.result : r)
}
// MCP tool schemas change as servers come up/down — we cache for 5s to
// avoid pinging main on every single chat turn.
let _mcpToolCache = { at: 0, tools: [] }
async function getMcpTools() {
  const now = Date.now()
  if (now - _mcpToolCache.at < 5000) return _mcpToolCache.tools
  const r = await _bridge(_pendingMcpLists, 'mcp-list')
  const tools = r && r.tools ? r.tools : []
  _mcpToolCache = { at: now, tools }
  return tools
}

/** Truncate tool args into a short, renderer-safe summary string. */
function summarizeArgs(name, args) {
  if (!args) return ''
  if (name === 'run_command') return String(args.command || '').slice(0, 80)
  if (name === 'read_file' || name === 'write_file') return String(args.path || '').slice(0, 80)
  if (name === 'list_directory') return String(args.path || '.').slice(0, 80)
  if (name === 'open_in_browser') return String(args.url || '').slice(0, 80)
  if (name === 'start_dev_server') return String(args.command || '').slice(0, 80)
  if (name === 'browser_navigate') return String(args.url || '').slice(0, 80)
  if (name === 'browser_get_text' || name === 'browser_click') return String(args.selector || '').slice(0, 80)
  if (name === 'browser_fill') return `${(args.selector || '').slice(0, 40)} ← ${(args.text || '').slice(0, 30)}`
  if (name === 'browser_screenshot') return ''
  if (name === 'screen_click' || name === 'screen_move_mouse') return `(${args.x || 0}, ${args.y || 0})`
  if (name === 'screen_type') return (args.text || '').slice(0, 60)
  if (name === 'screen_key') return String(args.combo || '')
  if (name === 'analyze_lab_result') return `${args.test_name} = ${args.value}`
  if (name === 'health_calculator') return String(args.calculator || '')
  if (name === 'check_drug_interactions') return (args.drugs || []).join(', ').slice(0, 80)
  if (name === 'score_phq9' || name === 'score_gad7') return name.toUpperCase()
  return ''
}

async function handleChat({ messages, model, workspacePath, spacePrompt, id, messageId, mode }) {
  process.stderr.write(`[worker] handleChat called — model="${model}" (type: ${typeof model})\n`)
  let provider = detectProvider(model)
  if (!model) {
    if (getApiKey('openai')) { provider = 'openai'; model = 'gpt-4o' }
    else if (getApiKey('anthropic')) { provider = 'anthropic'; model = 'claude-sonnet-4-5' }
    else throw new Error('No API key configured')
  }
  process.stderr.write(`[worker] resolved provider="${provider}" model="${model}"\n`)

  // Pull the user's latest turn so we can decide which rich-output docs to
  // ship. The full primer used to be ~500 tokens on every call — that cost
  // 1–3s of prompt-eval latency on local models for a simple "hi". We now
  // only include the block docs the user's intent actually hints at.
  const lastUserText = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role !== 'user') continue
      if (typeof m.content === 'string') return m.content
      if (Array.isArray(m.content)) return m.content.filter(p => p?.type === 'text').map(p => p.text || '').join(' ')
    }
    return ''
  })()

  const sysPrompt = buildSystemPrompt({
    provider,
    model,
    workspacePath,
    spacePrompt,
    userText: lastUserText,
  })

  // Wrap every activity event with the renderer messageId so the renderer can
  // route tokens to the right lane in council / multi-model mode.
  const onActivity = (activity) => emitActivity(id, { ...activity, messageId })

  if (provider === 'anthropic') {
    return await chatAnthropic(messages, model, workspacePath, sysPrompt, { onActivity, mode })
  } else if (provider === 'google') {
    return await chatGemini(messages, model, sysPrompt)
  } else if (provider === 'ollama') {
    const skipTools = shouldSkipToolsForLocal(model)
    const normalised = normalizeModelId(model)
    // Thinking models (Qwen 3, DeepSeek-R1, QwQ) get Ollama's native /api/chat
    // endpoint because OpenAI-compat silently drops chat_template_kwargs.
    // Measured: "hi" reply dropped from 48s → 0.7s by switching endpoints.
    if (isThinkingLocalModel(normalised)) {
      return await chatOllamaNative(messages, normalised, workspacePath, sysPrompt, { skipTools, onActivity, mode })
    }
    return await chatOpenAI(messages, normalised, provider, workspacePath, sysPrompt, { skipTools, onActivity, mode })
  } else {
    // v0.7.61: strip any routing-hint prefix (e.g. `kimi-intl/`) so the
    // SDK sees the raw upstream model id. Case is preserved — MiniMax
    // and other case-sensitive providers need `MiniMax-M2.7` unchanged.
    return await chatOpenAI(messages, normalizeModelId(model), provider, workspacePath, sysPrompt, { onActivity, mode })
  }
}

async function chatOpenAI(msgs, model, provider, workspacePath, sysPrompt, opts = {}) {
  const { skipTools = false, onActivity = () => {}, mode = 'autopilot' } = opts
  const OpenAI = require('openai').default || require('openai')
  // Ollama runs locally; keep a shorter timeout for external providers, longer for local generation.
  const timeout = provider === 'ollama' ? 300000 : 45000
  // DashScope / Zhipu / Moonshot occasionally leave HTTPS connections in a
  // half-open state. Reusing one via keep-alive makes the NEXT chat hang for
  // the full timeout × retry count (observed: 6 DNS hits in 2 min on a turn
  // that completes in 1s when tested fresh). Force a fresh connection per
  // request and cap the SDK's own retry budget so we fail fast instead of
  // retrying against the same dead socket.
  const wrappedFetch = async (url, init = {}) => {
    const headers = new Headers(init.headers || {})
    headers.set('Connection', 'close')
    return globalThis.fetch(url, { ...init, headers })
  }
  const client = new OpenAI({
    apiKey: getApiKey(provider),
    ...(getBaseURL(provider) ? { baseURL: getBaseURL(provider) } : {}),
    timeout,
    maxRetries: 1,  // default is 2; one hung socket would otherwise eat ~3× timeout
    fetch: wrappedFetch,
  })

  // v0.7.65: preserve `reasoning_content` on assistant turns — DeepSeek
  // V4 thinking-mode requires it be round-tripped in history. Other
  // providers silently ignore unknown message fields (OpenAI spec).
  const chatMsgs = [{ role: 'system', content: sysPrompt }, ...msgs.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
  }))]
  // Tool budget: workspace tools only if a folder is picked; health tools
  // only when the user is inside the health space (avoids token bloat
  // everywhere else, and avoids models in unrelated spaces inventing
  // "analyze_lab_result" calls on random input).
  const isHealthSpace = (sysPrompt || '').includes('health information assistant')
  const mcpTools = skipTools ? [] : await getMcpTools().catch(() => [])
  const allTools = skipTools ? [] : [
    ...(workspacePath ? TOOLS : []),
    ...BROWSER_TOOLS,     // v0.5.5: browser agent tools are always available
    ...SCREEN_TOOLS,      // v0.5.10: full screen control
    ...mcpTools,          // v0.5.6: tools from any user-configured MCP servers
    ...(isHealthSpace ? HEALTH_TOOLS : []),
  ]
  const useTools = allTools.length > 0 ? allTools : undefined

  // Qwen 3 / DeepSeek-R1 / QwQ default to emitting reasoning ("thinking")
  // tokens through Ollama's OpenAI-compatible endpoint. Those tokens aren't
  // in delta.content, so Alaude never renders them — yet the user still
  // waits while the GPU generates them. Passing the Jinja-template kwarg
  // enable_thinking=false suppresses the <think>...</think> block at the
  // Ollama layer. Only for local (Ollama) provider; cloud Qwen models
  // handle this differently.
  const suppressThinking = provider === 'ollama' && isThinkingLocalModel(model)
  let fullText = '', toolLog = ''

  for (let i = 0; i < 10; i++) {
    if (i > 0) onActivity({ phase: 'thinking', step: i })

    // Stream tokens live. Each content delta is emitted as a `token` activity;
    // tool_calls arrive as deltas too and are accumulated by index so the final
    // assembled message matches the non-streaming shape.
    let msg = null
    try {
      const stream = await client.chat.completions.create({
        model, messages: chatMsgs, max_completion_tokens: 4096, stream: true,
        ...(useTools ? { tools: useTools } : {}),
        ...(suppressThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      })
      let iterContent = ''
      // v0.7.65: DeepSeek's thinking-mode responses stream a separate
      // `delta.reasoning_content` channel. We aggregate it here and
      // carry it forward in the multi-turn history — DeepSeek's API
      // returns 400 "reasoning_content must be passed back" otherwise.
      let iterReasoning = ''
      // v0.7.67 streaming verification: track the last finish_reason so we
      // can detect token-cap truncation ("length") and other anomalies after
      // the loop ends. Many providers send finish_reason in the FINAL chunk
      // only, so we overwrite on every non-null sighting.
      let lastFinishReason = null
      const partialTools = []
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) lastFinishReason = choice.finish_reason
        const delta = choice?.delta
        if (!delta) continue
        if (delta.reasoning_content) {
          iterReasoning += delta.reasoning_content
          // Surface the reasoning tokens to the renderer as a distinct
          // activity phase — the UI can choose to hide them (default) or
          // render a collapsible "thinking" panel.
          onActivity({ phase: 'reasoning_token', text: delta.reasoning_content })
        }
        if (delta.content) {
          iterContent += delta.content
          onActivity({ phase: 'token', text: delta.content })
        }
        if (delta.tool_calls) {
          for (const tcd of delta.tool_calls) {
            const idx = tcd.index ?? 0
            if (!partialTools[idx]) partialTools[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } }
            if (tcd.id) partialTools[idx].id = tcd.id
            if (tcd.function?.name) partialTools[idx].function.name += tcd.function.name
            if (tcd.function?.arguments) partialTools[idx].function.arguments += tcd.function.arguments
          }
        }
      }
      // v0.7.67 streaming verification — post-stream sanity checks.
      // We do NOT throw on warnings; we surface them so the user understands
      // why a response looks short or empty, and we keep going.
      if (lastFinishReason === 'length') {
        const note = '\n\n⚠️ Response was cut off at the model\'s token limit. Ask "continue" to resume from where it stopped.'
        iterContent += note
        onActivity({ phase: 'stream_warning', reason: 'length_cap', note })
        process.stderr.write(`[worker] stream truncated by length cap (model=${model})\n`)
      } else if (!iterContent && !iterReasoning && !partialTools.length) {
        // No text, no reasoning, no tool calls — most likely a transient
        // server-side issue. Log loudly; don't fake content.
        process.stderr.write(`[worker] stream ended with no content / no tool_calls / no reasoning (finish_reason=${lastFinishReason}, model=${model})\n`)
        onActivity({ phase: 'stream_warning', reason: 'empty_stream' })
      }
      // Validate any tool-call arguments JSON now, before they're handed to
      // executeToolCall. Malformed JSON used to crash the whole turn at the
      // JSON.parse() below; instead we drop bad calls with a clear error.
      const validatedTools = partialTools.filter((tc, idx) => {
        if (!tc.function?.name) {
          process.stderr.write(`[worker] dropped tool_call ${idx}: missing function name\n`)
          return false
        }
        try {
          JSON.parse(tc.function.arguments || '{}')
          return true
        } catch (e) {
          process.stderr.write(`[worker] dropped tool_call "${tc.function.name}": malformed args JSON: ${e.message}\n`)
          onActivity({ phase: 'stream_warning', reason: 'bad_tool_args', name: tc.function.name })
          return false
        }
      })
      partialTools.length = 0
      partialTools.push(...validatedTools)
      // OpenAI spec: content can only be null when tool_calls is set. If no
      // tools AND no text came back, send an empty string so the next turn's
      // history stays valid.
      msg = {
        role: 'assistant',
        content: partialTools.length ? (iterContent || null) : (iterContent || ''),
        ...(partialTools.length ? { tool_calls: partialTools } : {}),
        // Preserve reasoning_content so DeepSeek's next-turn validator
        // finds it in history. Other providers ignore unknown fields.
        ...(iterReasoning ? { reasoning_content: iterReasoning } : {}),
      }
    } catch (streamErr) {
      // Streaming not supported or failed — fall back to non-streaming on this iteration only
      process.stderr.write(`[worker] streaming failed (${streamErr.message}) — falling back to non-streaming\n`)
      const res = await client.chat.completions.create({
        model, messages: chatMsgs, max_completion_tokens: 4096,
        ...(useTools ? { tools: useTools } : {}),
        ...(suppressThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      })
      msg = res.choices?.[0]?.message
    }

    if (!msg) break
    chatMsgs.push(msg)
    if (msg.content) fullText += msg.content
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        // v0.7.67 — second-line JSON.parse safety. The streaming validator
        // above already filters malformed args, but the non-streaming
        // fallback path doesn't run that check, so we guard here too.
        let args
        try { args = JSON.parse(tc.function.arguments || '{}') }
        catch (e) {
          process.stderr.write(`[worker] non-streaming bad tool args for ${tc.function.name}: ${e.message}\n`)
          onActivity({ phase: 'stream_warning', reason: 'bad_tool_args', name: tc.function.name })
          chatMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'tool arguments were not valid JSON; the model needs to retry' }) })
          continue
        }
        onActivity({ phase: 'tool_start', name: tc.function.name, args: summarizeArgs(tc.function.name, args) })
        const result = await executeToolCall(tc.function.name, args, workspacePath, mode)
        onActivity({ phase: 'tool_end', name: tc.function.name, ok: !result?.error })
        // Emit a structured file_edit event with old/new content so the renderer
        // can show a live colored diff inline in the chat bubble.
        if (tc.function.name === 'write_file' && result?.success) {
          onActivity({
            phase: 'file_edit',
            path: result.path,
            oldContent: result.oldContent,
            newContent: result.newContent,
            isNewFile: result.isNewFile,
          })
        }
        // Rich health cards for visual results
        const healthCard = formatHealthCard(tc.function.name, args, result)
        if (healthCard) { toolLog += '\n' + healthCard }
        else if (tc.function.name === 'write_file') toolLog += `\n📝 Wrote \`${args.path}\``
        else if (tc.function.name === 'read_file') toolLog += `\n📖 Read \`${args.path}\``
        else if (tc.function.name === 'list_directory') toolLog += `\n📁 Listed \`${args.path || '.'}\``
        else if (tc.function.name === 'run_command') { toolLog += `\n⚡ Ran \`${args.command}\``; if (result.output) toolLog += `\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\`` }
        else if (tc.function.name === 'open_in_browser') { toolLog += `\n🌐 Opened \`${args.url}\`` }
        else if (tc.function.name === 'start_dev_server') { toolLog += `\n🚀 Started server: \`${args.command}\` (PID ${result.pid || '?'})` }
        chatMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }
      continue
    }
    break
  }
  // Screen response for health red flags
  const responseText = (fullText + toolLog) || '(Done)'
  const { screenForRedFlags, formatRedFlagAlert } = require(_path.join(healthDir, 'triage-engine.js'))
  // Screen both last user message and AI response
  const lastUserMsg = msgs[msgs.length - 1]?.content || ''
  const triageResult = screenForRedFlags(lastUserMsg) || screenForRedFlags(responseText)
  if (triageResult) {
    return responseText + '\n\n' + formatRedFlagAlert(triageResult)
  }
  return responseText
}

/**
 * Chat with an Ollama model via its NATIVE /api/chat endpoint.
 *
 * Why not just use chatOpenAI with the /v1 compat layer?
 *   For thinking models (Qwen 3, DeepSeek-R1, QwQ), Ollama's compat layer
 *   silently drops `chat_template_kwargs`, so we can't disable the
 *   reasoning output. Reasoning tokens are invisible to Alaude (only
 *   delta.content is captured) yet still cost ~600 tokens of generation
 *   time per turn. On a 36B Qwen 3 MoE, that's the difference between
 *   a 1-second reply and a 50-second one.
 *
 * The native endpoint accepts `think: false` directly and omits the
 * reasoning entirely. It also supports `options: {num_predict, temperature}`
 * for sampling control and streams NDJSON.
 *
 * Tools: Ollama's native API DOES support `tools` with the same JSON-Schema
 * shape as OpenAI, and returns `message.tool_calls` when the model invokes
 * one. We implement the same tool-loop as chatOpenAI with up to 10 rounds.
 */
async function chatOllamaNative(msgs, model, workspacePath, sysPrompt, opts = {}) {
  const { skipTools = false, onActivity = () => {}, mode = 'autopilot' } = opts
  const baseURL = 'http://localhost:11434'
  // v0.7.65: preserve `reasoning_content` on assistant turns — DeepSeek
  // V4 thinking-mode requires it be round-tripped in history. Other
  // providers silently ignore unknown message fields (OpenAI spec).
  const chatMsgs = [{ role: 'system', content: sysPrompt }, ...msgs.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
  }))]
  const isHealthSpace = (sysPrompt || '').includes('health information assistant')
  const mcpTools = skipTools ? [] : await getMcpTools().catch(() => [])
  const allTools = skipTools ? [] : [
    ...(workspacePath ? TOOLS : []),
    ...BROWSER_TOOLS,     // v0.5.5: browser agent tools are always available
    ...SCREEN_TOOLS,      // v0.5.10: full screen control
    ...mcpTools,          // v0.5.6: tools from any user-configured MCP servers
    ...(isHealthSpace ? HEALTH_TOOLS : []),
  ]
  const useTools = allTools.length > 0 ? allTools : undefined

  let fullText = ''
  for (let iter = 0; iter < 10; iter++) {
    if (iter > 0) onActivity({ phase: 'thinking', step: iter })

    const body = {
      model,
      messages: chatMsgs,
      stream: true,
      think: false, // critical: suppresses reasoning tokens for Qwen 3 / R1 / QwQ
      options: { num_predict: 4096 },
      ...(useTools ? { tools: useTools } : {}),
    }
    // Stream NDJSON. Each line is a {message:{role,content,thinking?,tool_calls?},done?} object.
    // Sanitize messages: Ollama's native API rejects OpenAI-shaped `tool` role
    // messages that use `tool_call_id`. It expects `tool_name` instead. Also
    // strip fields it doesn't recognize on assistant messages.
    body.messages = body.messages.map(m => {
      if (m.role === 'tool') {
        // OpenAI shape → Ollama shape. Ollama takes `tool_name` keyed to the
        // most recent tool_calls entry in the preceding assistant msg.
        const out = { role: 'tool', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
        if (m.tool_name) out.tool_name = m.tool_name
        return out
      }
      // Content may be a multimodal array — flatten text parts for Ollama.
      let content = m.content
      if (Array.isArray(content)) {
        content = content.filter(p => p?.type === 'text').map(p => p.text || '').join('\n')
      }
      return { role: m.role, content: content == null ? '' : String(content) }
    })

    let res
    try {
      res = await fetch(`${baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (netErr) {
      throw new Error(`Ollama /api/chat network error: ${netErr.message}`)
    }
    if (!res.ok) {
      let errBody = ''
      try { errBody = (await res.text()).slice(0, 300) } catch {}
      process.stderr.write(`[worker] Ollama /api/chat ${res.status}: ${errBody}\n`)
      process.stderr.write(`[worker] request payload (truncated): ${JSON.stringify(body).slice(0, 600)}\n`)
      throw new Error(`Ollama /api/chat failed: ${res.status} ${res.statusText}${errBody ? ' — ' + errBody : ''}`)
    }

    let assistantMsg = { role: 'assistant', content: '' }
    const partialTools = []
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let newlineIdx
      while ((newlineIdx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, newlineIdx).trim()
        buf = buf.slice(newlineIdx + 1)
        if (!line) continue
        let chunk
        try { chunk = JSON.parse(line) } catch { continue }
        const m = chunk.message || {}
        if (m.content) {
          assistantMsg.content += m.content
          onActivity({ phase: 'token', text: m.content })
        }
        if (m.tool_calls?.length) {
          for (const tcd of m.tool_calls) {
            partialTools.push({
              id: tcd.id || ('tc_' + Math.random().toString(36).slice(2, 8)),
              type: 'function',
              function: {
                name: tcd.function?.name || '',
                arguments: typeof tcd.function?.arguments === 'string'
                  ? tcd.function.arguments
                  : JSON.stringify(tcd.function?.arguments || {}),
              },
            })
          }
        }
      }
    }

    if (partialTools.length) assistantMsg.tool_calls = partialTools
    chatMsgs.push(assistantMsg)
    if (assistantMsg.content) fullText += assistantMsg.content
    if (!assistantMsg.tool_calls?.length) break

    // Tool-use round: execute each call and feed results back.
    for (const tc of assistantMsg.tool_calls) {
      let args
      try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = {} }
      onActivity({ phase: 'tool_start', name: tc.function.name, args: summarizeArgs(tc.function.name, args) })
      const result = await executeToolCall(tc.function.name, args, workspacePath, mode)
      onActivity({ phase: 'tool_end', name: tc.function.name, ok: !result?.error })
      if (tc.function.name === 'write_file' && result?.success) {
        onActivity({
          phase: 'file_edit',
          path: result.path,
          oldContent: result.oldContent,
          newContent: result.newContent,
          isNewFile: result.isNewFile,
        })
      }
      // Ollama native shape: `tool_name` keys the result back to the function,
      // not an OpenAI-style tool_call_id.
      chatMsgs.push({ role: 'tool', tool_name: tc.function.name, content: JSON.stringify(result).slice(0, 50000) })
    }
  }
  return fullText || '(no response)'
}

async function chatAnthropic(msgs, model, workspacePath, sysPrompt, opts = {}) {
  const { onActivity = () => {}, mode = 'autopilot' } = opts
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
  // Anthropic accepts either an API key (x-api-key) or an OAuth Bearer
  // token. The SDK takes authToken for Bearer auth. When the credential
  // came from the OAuth PKCE flow via claude.com, we must send Bearer
  // plus the anthropic-beta header that unlocks the oauth scope.
  const cred = getCredential('anthropic') || { value: '', isOauth: false }
  const clientOpts = { timeout: 60000, fetch: globalThis.fetch }
  if (cred.isOauth) {
    clientOpts.authToken = cred.value
    clientOpts.defaultHeaders = { 'anthropic-beta': 'oauth-2025-04-20' }
  } else {
    clientOpts.apiKey = cred.value
  }
  const client = new Anthropic(clientOpts)
  const isHealthSpace = (sysPrompt || '').includes('health information assistant')
  const mcpTools = await getMcpTools().catch(() => [])
  const allAnthTools = [...(workspacePath ? TOOLS : []), ...BROWSER_TOOLS, ...SCREEN_TOOLS, ...mcpTools, ...(isHealthSpace ? HEALTH_TOOLS : [])]
  const anthTools = allAnthTools.length > 0 ? allAnthTools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) : undefined
  // Multimodal: the renderer produces content in OpenAI shape. Reshape any
  // array-content messages to Anthropic's content-block format. Image URLs
  // arrive as data URLs (data:image/png;base64,…) — Anthropic wants the raw
  // base64 + media_type separately.
  const reshape = (content) => {
    if (!Array.isArray(content)) return content
    return content.map(part => {
      if (part?.type === 'image_url') {
        const url = part.image_url?.url || ''
        const m = /^data:([^;]+);base64,(.+)$/.exec(url)
        if (m) {
          return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
        }
        // Remote URL (unlikely from the renderer but handle it)
        return { type: 'image', source: { type: 'url', url } }
      }
      if (part?.type === 'text') return { type: 'text', text: part.text || '' }
      return part
    })
  }
  const chatMsgs = msgs.map(m => ({ role: m.role, content: reshape(m.content) }))
  let fullText = '', toolLog = ''

  for (let i = 0; i < 10; i++) {
    if (i > 0) onActivity({ phase: 'thinking', step: i })

    // Stream tokens live via the Anthropic SDK's stream helper, then pull the
    // assembled final message at the end — same shape as non-streaming create().
    // Fall back to non-streaming on any failure.
    let res
    try {
      const stream = client.messages.stream({
        model, max_tokens: 4096, system: sysPrompt, messages: chatMsgs,
        ...(anthTools ? { tools: anthTools } : {}),
      })
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          onActivity({ phase: 'token', text: event.delta.text })
        }
      }
      res = await stream.finalMessage()
    } catch (streamErr) {
      process.stderr.write(`[worker] anthropic streaming failed (${streamErr.message}) — falling back\n`)
      res = await client.messages.create({ model, max_tokens: 4096, system: sysPrompt, messages: chatMsgs, ...(anthTools ? { tools: anthTools } : {}) })
    }

    // v0.7.67 — verify Anthropic stream completeness via stop_reason.
    // Healthy values: "end_turn" (done), "tool_use" (will iterate), "stop_sequence".
    // "max_tokens" means truncated → tell the user.
    if (res?.stop_reason === 'max_tokens') {
      const note = '\n\n⚠️ Response was cut off at the model\'s token limit. Ask "continue" to resume.'
      fullText += note
      onActivity({ phase: 'stream_warning', reason: 'length_cap', note })
      process.stderr.write(`[worker] anthropic stream truncated by max_tokens (model=${model})\n`)
    } else if (!res?.content?.length) {
      process.stderr.write(`[worker] anthropic stream returned empty content (stop_reason=${res?.stop_reason}, model=${model})\n`)
      onActivity({ phase: 'stream_warning', reason: 'empty_stream' })
    }

    for (const b of res.content) { if (b.type === 'text') fullText += b.text }
    const tuBlocks = res.content.filter(b => b.type === 'tool_use')
    if (tuBlocks.length) {
      chatMsgs.push({ role: 'assistant', content: res.content })
      const results = []
      for (const tu of tuBlocks) {
        onActivity({ phase: 'tool_start', name: tu.name, args: summarizeArgs(tu.name, tu.input) })
        const result = await executeToolCall(tu.name, tu.input, workspacePath, mode)
        onActivity({ phase: 'tool_end', name: tu.name, ok: !result?.error })
        if (tu.name === 'write_file' && result?.success) {
          onActivity({
            phase: 'file_edit',
            path: result.path,
            oldContent: result.oldContent,
            newContent: result.newContent,
            isNewFile: result.isNewFile,
          })
        }
        const healthCard = formatHealthCard(tu.name, tu.input, result)
        if (healthCard) { toolLog += '\n' + healthCard }
        else if (tu.name === 'write_file') toolLog += `\n📝 Wrote \`${tu.input.path}\``
        else if (tu.name === 'read_file') toolLog += `\n📖 Read \`${tu.input.path}\``
        else if (tu.name === 'list_directory') toolLog += `\n📁 Listed \`${tu.input.path || '.'}\``
        else if (tu.name === 'run_command') { toolLog += `\n⚡ Ran \`${tu.input.command}\``; if (result.output) toolLog += `\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\`` }
        else if (tu.name === 'open_in_browser') { toolLog += `\n🌐 Opened \`${tu.input.url}\`` }
        else if (tu.name === 'start_dev_server') { toolLog += `\n🚀 Started server: \`${tu.input.command}\` (PID ${result.pid || '?'})` }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
      }
      chatMsgs.push({ role: 'user', content: results })
      continue
    }
    break
  }
  const anthrResponseText = (fullText + toolLog) || '(Done)'
  const triage = require(_path.join(healthDir, 'triage-engine.js'))
  const lastUser = msgs[msgs.length - 1]?.content || ''
  const anthrTriage = triage.screenForRedFlags(lastUser) || triage.screenForRedFlags(anthrResponseText)
  if (anthrTriage) return anthrResponseText + '\n\n' + triage.formatRedFlagAlert(anthrTriage)
  return anthrResponseText
}

async function chatGemini(msgs, model, sysPrompt) {
  const { GoogleGenAI } = require('@google/genai')
  const client = new GoogleGenAI({ apiKey: getApiKey('google') })
  const chatMsgs = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const res = await client.models.generateContent({ model: model || 'gemini-2.0-flash', contents: chatMsgs, ...(sysPrompt ? { systemInstruction: sysPrompt } : {}) })
  return res.text || '(No response)'
}

// ── Message loop ─────────────────────────────────────────────────────────────
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (!line.trim()) continue
    try {
      const req = JSON.parse(line)
      // v0.5.5: browser-tool responses coming back from main — resolve the
      // pending requestBrowserTool() promise instead of treating as a chat.
      if (req.type === 'browser-tool-response') {
        const resolver = _pendingBrowserTools.get(req.id)
        if (resolver) { _pendingBrowserTools.delete(req.id); resolver(req.result) }
        continue
      }
      if (req.type === 'screen-tool-response') {
        const resolver = _pendingScreenTools.get(req.id)
        if (resolver) { _pendingScreenTools.delete(req.id); resolver(req.result) }
        continue
      }
      // v0.5.6: MCP responses
      if (req.type === 'mcp-call-response') {
        const resolver = _pendingMcpCalls.get(req.id)
        if (resolver) { _pendingMcpCalls.delete(req.id); resolver({ result: req.result }) }
        continue
      }
      if (req.type === 'mcp-list-response') {
        const resolver = _pendingMcpLists.get(req.id)
        if (resolver) { _pendingMcpLists.delete(req.id); resolver({ tools: req.tools }) }
        continue
      }
      _inFlightRequest = { id: req.id }
      handleChat(req)
        .then(result => {
          _inFlightRequest = null
          process.stdout.write(JSON.stringify({ id: req.id, result }) + '\n')
        })
        .catch(err => {
          _inFlightRequest = null
          process.stdout.write(JSON.stringify({ id: req.id, error: err.message || String(err) }) + '\n')
        })
    } catch (err) {
      process.stdout.write(JSON.stringify({ error: 'Invalid JSON: ' + err.message }) + '\n')
    }
  }
})
