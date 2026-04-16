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

function getApiKey(provider) {
  // Ollama runs locally and ignores the key; the OpenAI SDK still requires a non-empty string.
  if (provider === 'ollama') return 'ollama'
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

  const dirs = [path.join(os.homedir(), '.claude'), path.join(os.homedir(), 'claude-local-src')]
  for (const dir of dirs) {
    try {
      const credPath = path.join(dir, '.credentials.json')
      if (fs.existsSync(credPath)) {
        const data = JSON.parse(fs.readFileSync(credPath, 'utf8'))
        if (data?.providerApiKeys?.[provider]) return data.providerApiKeys[provider]
      }
    } catch {}
  }
  return null
}

function getBaseURL(provider) {
  return {
    xai: 'https://api.x.ai/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    ollama: 'http://localhost:11434/v1',
  }[provider]
}

function detectProvider(model) {
  const m = (model || '').toLowerCase()
  // Local runtime: Ollama model tags use `name:tag` (e.g. qwen3:8b, gemma3:4b).
  // Explicit "ollama/" prefix also forces local routing.
  if (m.startsWith('ollama/') || m.startsWith('gemma') || m.startsWith('qwen3') || m.startsWith('llama3') || m.startsWith('deepseek-r1') || m.includes(':')) return 'ollama'
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai'
  if (m.startsWith('grok-')) return 'xai'
  if (m.startsWith('moonshot-') || m.startsWith('kimi-')) return 'moonshot'
  if (m.startsWith('qwen-')) return 'dashscope'
  if (m.startsWith('glm-')) return 'zhipu'
  if (m.startsWith('gemini')) return 'google'
  return 'anthropic'
}

/** Strip an optional "ollama/" prefix so the SDK sees the raw tag. */
function normalizeOllamaModel(model) {
  return (model || '').replace(/^ollama\//, '')
}

/**
 * Only skip tools for genuinely tiny / unreliable local models. Every modern
 * mid-to-large open-weight model supports OpenAI-style function calling fine.
 */
function shouldSkipToolsForLocal(model) {
  const m = normalizeOllamaModel(model).toLowerCase()
  // Known-poor tool callers at their smallest sizes
  if (m.startsWith('gemma3:1b')) return true
  if (m.startsWith('llama3.2:1b')) return true
  if (m.startsWith('llama3.2:3b')) return true
  // DeepSeek R1 distills wrap their output in <think> tags and often mis-format tool calls
  if (m.startsWith('deepseek-r1')) return true
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

async function executeToolCall(name, args, workspacePath) {
  const { execSync } = require('child_process')
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
    if (name === 'read_file') {
      const fp = path.resolve(workspacePath, args.path)
      return { content: fs.readFileSync(fp, 'utf8').slice(0, 50000) }
    }
    if (name === 'write_file') {
      const fp = path.resolve(workspacePath, args.path)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, args.content, 'utf8')
      return { success: true, path: args.path }
    }
    if (name === 'list_directory') {
      const dp = path.resolve(workspacePath, args.path || '.')
      const entries = fs.readdirSync(dp, { withFileTypes: true })
      return { entries: entries.filter(e => !e.name.startsWith('.')).slice(0, 100).map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') }
    }
    if (name === 'run_command') {
      const out = execSync(args.command, { cwd: workspacePath, timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(os.homedir(), '.bun', 'bin')}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` } })
      return { output: out.slice(0, 20000) }
    }
    if (name === 'open_in_browser') {
      const url = args.url
      let target = url
      // If it's a relative path, resolve to workspace
      if (!url.startsWith('http') && !url.startsWith('/')) {
        target = path.resolve(workspacePath, url)
      }
      const { exec } = require('child_process')
      exec(`open "${target}"`) // macOS; use xdg-open on Linux, start on Windows
      return { success: true, opened: target }
    }

    if (name === 'start_dev_server') {
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
      return { success: true, pid: child.pid, message: `Server started (PID ${child.pid}). Open http://localhost:${port}` }
    }

    return { error: `Unknown tool: ${name}` }
  } catch (err) { return { error: err.message } }
}

async function handleChat({ messages, model, workspacePath, spacePrompt }) {
  process.stderr.write(`[worker] handleChat called — model="${model}" (type: ${typeof model})\n`)
  let provider = detectProvider(model)
  if (!model) {
    if (getApiKey('openai')) { provider = 'openai'; model = 'gpt-4o' }
    else if (getApiKey('anthropic')) { provider = 'anthropic'; model = 'claude-sonnet-4-5-20250514' }
    else throw new Error('No API key configured')
  }
  process.stderr.write(`[worker] resolved provider="${provider}" model="${model}"\n`)

  let sysPrompt = 'You are Alaude, a helpful AI assistant.'
  if (workspacePath) {
    sysPrompt += ` Workspace: ${workspacePath}. Use tools to read/write files, list dirs, run commands. Always explain what you do.`
  }
  if (spacePrompt) {
    sysPrompt += '\n\n' + spacePrompt
  }

  if (provider === 'anthropic') {
    return await chatAnthropic(messages, model, workspacePath, sysPrompt)
  } else if (provider === 'google') {
    return await chatGemini(messages, model, sysPrompt)
  } else if (provider === 'ollama') {
    // Local models: OpenAI-compatible. Tool calling is enabled for capable
    // models (gemma3:4b+, gemma4:*, qwen3*, llama3*) and skipped for tiny
    // variants that produce garbage tool calls.
    const skipTools = shouldSkipToolsForLocal(model)
    return await chatOpenAI(messages, normalizeOllamaModel(model), provider, workspacePath, sysPrompt, { skipTools })
  } else {
    return await chatOpenAI(messages, model, provider, workspacePath, sysPrompt)
  }
}

async function chatOpenAI(msgs, model, provider, workspacePath, sysPrompt, opts = {}) {
  const { skipTools = false } = opts
  const OpenAI = require('openai').default || require('openai')
  // Ollama runs locally; keep a shorter timeout for external providers, longer for local generation.
  const timeout = provider === 'ollama' ? 300000 : 60000
  const client = new OpenAI({ apiKey: getApiKey(provider), ...(getBaseURL(provider) ? { baseURL: getBaseURL(provider) } : {}), timeout, fetch: globalThis.fetch })

  const chatMsgs = [{ role: 'system', content: sysPrompt }, ...msgs.map(m => ({ role: m.role, content: m.content }))]
  // Tool budget: workspace tools only if a folder is picked; health tools
  // only when the user is inside the health space (avoids token bloat
  // everywhere else, and avoids models in unrelated spaces inventing
  // "analyze_lab_result" calls on random input).
  const isHealthSpace = (sysPrompt || '').includes('health information assistant')
  const allTools = skipTools ? [] : [
    ...(workspacePath ? TOOLS : []),
    ...(isHealthSpace ? HEALTH_TOOLS : []),
  ]
  const useTools = allTools.length > 0 ? allTools : undefined
  let fullText = '', toolLog = ''

  for (let i = 0; i < 10; i++) {
    const res = await client.chat.completions.create({ model, messages: chatMsgs, max_completion_tokens: 4096, ...(useTools ? { tools: useTools } : {}) })
    const msg = res.choices?.[0]?.message
    if (!msg) break
    chatMsgs.push(msg)
    if (msg.content) fullText += msg.content
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments || '{}')
        const result = await executeToolCall(tc.function.name, args, workspacePath)
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

async function chatAnthropic(msgs, model, workspacePath, sysPrompt) {
  const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: getApiKey('anthropic'), timeout: 60000, fetch: globalThis.fetch })
  const isHealthSpace = (sysPrompt || '').includes('health information assistant')
  const allAnthTools = [...(workspacePath ? TOOLS : []), ...(isHealthSpace ? HEALTH_TOOLS : [])]
  const anthTools = allAnthTools.length > 0 ? allAnthTools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) : undefined
  const chatMsgs = msgs.map(m => ({ role: m.role, content: m.content }))
  let fullText = '', toolLog = ''

  for (let i = 0; i < 10; i++) {
    const res = await client.messages.create({ model, max_tokens: 4096, system: sysPrompt, messages: chatMsgs, ...(anthTools ? { tools: anthTools } : {}) })
    for (const b of res.content) { if (b.type === 'text') fullText += b.text }
    const tuBlocks = res.content.filter(b => b.type === 'tool_use')
    if (tuBlocks.length) {
      chatMsgs.push({ role: 'assistant', content: res.content })
      const results = []
      for (const tu of tuBlocks) {
        const result = await executeToolCall(tu.name, tu.input, workspacePath)
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
      handleChat(req)
        .then(result => process.stdout.write(JSON.stringify({ id: req.id, result }) + '\n'))
        .catch(err => process.stdout.write(JSON.stringify({ id: req.id, error: err.message || String(err) }) + '\n'))
    } catch (err) {
      process.stdout.write(JSON.stringify({ error: 'Invalid JSON: ' + err.message }) + '\n')
    }
  }
})
