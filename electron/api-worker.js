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
const paths = require('./paths')
// v0.8 — folder skills (SKILL.md). Plain fs module, safe in the worker.
const folderSkills = require('./folder-skills')

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
// v0.8: per-chat AbortControllers so main can stop a generation mid-stream.
const _activeAborts = new Map()  // chat id -> AbortController
function formatErrorForUser(err) {
  const base = err?.message || String(err)
  const cause = err?.cause?.message || err?.cause?.code || err?.error?.message
  if (cause && !base.includes(cause)) return `${base} (${cause})`
  if (err?.status && !base.includes(String(err.status))) return `${base} (HTTP ${err.status})`
  return base
}
process.on('uncaughtException', (err) => {
  try { process.stderr.write(`[worker] uncaughtException (recovered): ${err?.stack || err}\n`) } catch {}
  if (_inFlightRequest?.id != null) {
    try { process.stdout.write(JSON.stringify({ id: _inFlightRequest.id, error: formatErrorForUser(err) }) + '\n') } catch {}
    _inFlightRequest = null
  }
  // Do NOT exit — the loop can accept new work.
})
process.on('unhandledRejection', (err) => {
  try { process.stderr.write(`[worker] unhandledRejection: ${err?.stack || err}\n`) } catch {}
  if (_inFlightRequest?.id != null) {
    try { process.stdout.write(JSON.stringify({ id: _inFlightRequest.id, error: formatErrorForUser(err) }) + '\n') } catch {}
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

  let settled = false
  let fallbackTried = false
  const done = (...args) => {
    if (settled) return
    settled = true
    clearTimeout(fallbackTimer)
    clearTimeout(finalTimer)
    callback(...args)
  }
  const usePublicDns = (reason, allowFailure) => {
    if (fallbackTried || settled) return
    fallbackTried = true
    process.stderr.write(`[dns] ${reason}, trying public DNS\n`)
    publicResolver.resolve4(hostname, (err2, addresses) => {
      if (settled) return
      if (!err2 && addresses?.length) {
        process.stderr.write(`[dns] public DNS resolved ${hostname} -> ${addresses[0]}\n`)
        if (options.all) return done(null, addresses.map(a => ({ address: a, family: 4 })))
        return done(null, addresses[0], 4)
      }
      process.stderr.write(`[dns] public DNS failed for ${hostname}: ${(err2 && err2.message) || 'no addresses'}\n`)
      if (allowFailure) done(err2 || new Error(`DNS resolution failed for ${hostname}`))
    })
  }

  // Try system DNS first (preserves VPN routing). If it is merely slow, public
  // DNS can win early, but public failure no longer kills the still-pending
  // system lookup.
  const fallbackTimer = setTimeout(() => {
    usePublicDns(`system DNS timed out for ${hostname}`, false)
  }, 3000)
  const finalTimer = setTimeout(() => {
    done(new Error(`DNS resolution timed out for ${hostname}`))
  }, 20000)

  _origLookup.call(dns, hostname, options, (err, ...args) => {
    if (!err) {
      process.stderr.write(`[dns] system DNS resolved ${hostname}\n`)
      return done(null, ...args)
    }
    process.stderr.write(`[dns] system DNS failed for ${hostname}: ${err.message}\n`)
    usePublicDns(`system DNS failed for ${hostname}: ${err.message}`, true)
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
    paths.CREDENTIALS_FILE,
    path.join(paths.LEGACY_CLAUDE_DIR, '.credentials.json'),
    ...(paths.USING_CUSTOM_HOME ? [] : [path.join(os.homedir(), 'claude-local-src', '.credentials.json')]),
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

// v0.4.2 — git awareness. When the workspace is a git repo, inject a compact
// snapshot (branch, short status, recent commits) so the model knows what
// it's working on without having to spend tool calls on `git status` /
// `git log`. Mirrors the gitStatus block Claude Code seeds. Read fresh each
// turn — cheap (single-digit ms) and always current. Fails silently for
// non-repos or if git isn't installed.
function loadGitContext(workspacePath) {
  if (!workspacePath) return null
  const { execSync } = require('child_process')
  const run = (cmd) => {
    try {
      return execSync(cmd, { cwd: workspacePath, timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { return null }
  }
  const inside = run('git rev-parse --is-inside-work-tree')
  if (inside !== 'true') return null
  const branch = run('git rev-parse --abbrev-ref HEAD') || 'detached'
  // Porcelain status, capped so a huge uncommitted tree doesn't flood context.
  let status = run('git status --porcelain') || ''
  const statusLines = status ? status.split('\n') : []
  const STATUS_CAP = 30
  let statusBlock = statusLines.slice(0, STATUS_CAP).join('\n')
  if (statusLines.length > STATUS_CAP) statusBlock += `\n… and ${statusLines.length - STATUS_CAP} more changed file(s)`
  if (!statusBlock) statusBlock = '(clean)'
  const log = run('git log --oneline -5') || '(no commits yet)'
  return { branch, statusBlock, log, dirty: statusLines.length > 0 }
}

// v0.4.4 — @-mention expansion. The composer lets the user type "@path/to/file"
// to reference a workspace file (see updateAtMenu in the renderer). Here we
// resolve those tokens in the latest user turn and inline the file contents so
// the model sees them without spending a read_file tool call — Claude Code's
// @-mention behavior. Path-escape guarded: a mention that resolves outside the
// workspace, or to a missing/binary/huge file, is left as plain text.
const MENTION_MAX_BYTES = 24 * 1024
const MENTION_MAX_FILES = 10
function expandFileMentions(messages, workspacePath) {
  if (!workspacePath || !Array.isArray(messages)) return
  // Operate on the latest user turn only.
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { idx = i; break }
  }
  if (idx === -1) return
  const msg = messages[idx]
  const text = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content)
      ? msg.content.filter(p => p?.type === 'text').map(p => p.text || '').join('\n')
      : ''
  if (!text || text.indexOf('@') === -1) return
  const root = path.resolve(workspacePath)
  const seen = new Set()
  const blocks = []
  const re = /(^|\s)@([^\s@]+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (blocks.length >= MENTION_MAX_FILES) break
    // Trim trailing punctuation that's likely sentence grammar, not the path.
    let rel = m[2].replace(/[.,;:)\]]+$/, '')
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    const fp = path.resolve(root, rel)
    if (fp !== root && !fp.startsWith(root + path.sep)) continue   // escapes workspace
    try {
      const st = fs.statSync(fp)
      if (!st.isFile()) continue
      let body = fs.readFileSync(fp, 'utf8')
      if (body.includes("\u0000")) continue  // null byte -> binary
      const overBytes = Buffer.byteLength(body, 'utf8') > MENTION_MAX_BYTES
      if (overBytes) body = body.slice(0, MENTION_MAX_BYTES) + `\n… [truncated — @${rel} is larger than ${MENTION_MAX_BYTES / 1024}KB]`
      const ext = (rel.split('.').pop() || '').toLowerCase()
      blocks.push(`### @${rel}\n\n\`\`\`${ext}\n${body}\n\`\`\``)
    } catch { /* missing / unreadable — leave token as plain text */ }
  }
  if (!blocks.length) return
  const attachment = `\n\n---\nReferenced files (auto-attached from @ mentions):\n\n${blocks.join('\n\n')}`
  if (typeof msg.content === 'string') {
    msg.content = msg.content + attachment
  } else if (Array.isArray(msg.content)) {
    msg.content = [...msg.content, { type: 'text', text: attachment }]
  }
  try { console.error(`[worker] Expanded ${blocks.length} @-mention(s) into context`) } catch {}
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
    // v0.4.4 — tell the model that @-mentioned files are pre-attached.
    sys += ` If the user references a file with @path (e.g. "@src/app.js"), its contents are auto-attached below under "Referenced files" — read from there instead of re-reading with a tool.`
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
    // v0.4.2 — git snapshot so the model has repo context for free.
    const git = loadGitContext(workspacePath)
    if (git) {
      sys += `\n\n## Git status\n\nBranch: ${git.branch}\n\nStatus${git.dirty ? '' : ' (clean)'}:\n${git.statusBlock}\n\nRecent commits:\n${git.log}\n\nUse this for context (don't re-run git status/log unless you need fresher data). Never commit, push, or change git history unless the user explicitly asks.`
      try { console.error(`[worker] Injected git context (branch ${git.branch}, ${git.dirty ? 'dirty' : 'clean'})`) } catch {}
    }
    // v0.4.3 — live task list. For multi-step work, the model maintains a
    // checklist the user can watch progress against. Skip for local models
    // (extra tokens hurt small-model latency/quality).
    if (provider !== 'ollama') {
      sys += `

## Task checklist (multi-step work)

When a request needs 3+ distinct steps, maintain a live checklist so the
user can see progress. Emit a fenced \`\`\`todos\`\`\` JSON block:

\`\`\`todos
{"items":[
  {"title":"Short task description","status":"done"},
  {"title":"The step you're on now","status":"in_progress"},
  {"title":"A step not started yet","status":"todo"}
]}
\`\`\`

Rules:
- status is one of: "todo", "in_progress", "done".
- Keep exactly ONE item "in_progress" at a time.
- RE-EMIT the FULL updated list each time you report progress (after
  finishing steps / between tool batches), flipping statuses as you go —
  the UI shows the latest block as a live progress card.
- Titles are short (3-8 words), user-facing, no file paths.
- Skip the checklist for simple 1-2 step requests — it's only worth the
  noise on genuinely multi-step tasks.`
    }
  }
  // v0.7.67 — Browser/web tools restraint. The browser_* tools are tempting
  // for the model to use speculatively ("let me look up this package on
  // npm"), which surprises the user with a popped-up Chromium window they
  // didn't ask for. This system-level guard tells the model to treat
  // browser tools as opt-in: only fire when the user explicitly asks.
  sys += `

## Web search

web_search / fetch_page are available for CURRENT or external info (news,
prices, releases, post-cutoff facts). Use them when freshness matters;
don't search for things you already know. Cite the source URL when you
use a result.`
  // v0.8 cycle 32 — the browser-restraint block (~230 tok) is only relevant
  // when browser_* tools are actually offered, which (since cycle 6) only
  // happens when the user's message signals browser intent. On every other
  // message the tools don't exist, so the warning is dead weight. Gate it on
  // the same intent signal over userText.
  if (/\bhttps?:\/\/\S+|\bbrowse\b|navigate to|open the (url|link|page|site|website)|look (it|that|this) up online|search the web|scrape|\bbrowser\b/i.test(userText || '')) {
    sys += `

## Browser tools

The browser_* tools open a real Chromium window. Use them only for the
specific URL/site the user asked about — don't browse to look up docs,
"verify" facts, or grab sample code (write those from training). When in
doubt, ask before opening a window.`
  }

  // v0.7.72 — Output cleanliness rules. Two failure modes the user has
  // flagged: chatty per-step narration during tool work, and raw shell
  // stderr (pip notices, install spam) pasted into the assistant's reply.
  sys += `

## Output cleanliness

The Labaik UI shows live activity chips while you call tools, so you
DO NOT need to narrate "Let me X… Now Y… Server is live… Let me open
it…" as plain text. The chips already say what's happening; doubling
it as prose is noise.

When tools return verbose output (pip notices, npm warnings, deprecated
flags, install logs, lint warnings about the tool itself), do NOT
paste them into your reply. Pull out only what's useful to the user
("installed 4 packages", "tests passed") and skip the rest. Tool
stderr that's irrelevant to the user's request belongs in the worker
log, not in chat.

When you mention a filename, write it as plain text — \`app.py\` or
just app.py — never as a markdown link to a fake URL. Same for
sentence-end words: write "scaffold it now. Now let me…" with a real
sentence break, not a domain-looking pseudo-link.`

  // v0.7.67 — Ask-user-question capability (compressed v0.8 cycle 31: the
  // full block was ~930 tokens on EVERY message; this keeps the schema +
  // the rules that matter and drops the redundant domain examples, saving
  // ~650 tokens/message with no behavior change).
  sys += `

## Asking clarifying questions

When the request has a real fork (scope / format / approach / tone /
depth / audience) and a wrong guess would waste the user's time or money,
ask 1-3 questions via a SINGLE fenced \`\`\`ask\`\`\` block — the UI renders it
as one popup with pickers and a "Skip — use defaults" button. Don't ask
when intent is clear, the answer is already in the conversation, the
decision is trivial (just state your assumption), or you need free-form
data like a name/path/URL (use prose). Never emit more than one ask-block
per turn, and don't re-ask after a Skip — proceed with the recommended
options.

\`\`\`ask
{"questions":[
  {"question":"How long should the summary be?","options":[
    {"label":"One paragraph","desc":"Quick gist","recommended":true},
    {"label":"One page","desc":"Structured, ~500 words"},
    {"label":"Full deep-dive","desc":"Everything"}]}
]}
\`\`\`

Rules: ≤3 questions; 2-4 options each (3 is best); EXACTLY ONE option per
question marked \`"recommended": true\`; each \`desc\` one short sentence.`
  // v0.8 — folder skills index. Names + descriptions only; bodies load via
  // the use_skill tool so unused skills cost ~a line of tokens each. Skipped
  // for local models (same latency budget reasoning as the task checklist —
  // and tool-less local models couldn't call use_skill anyway).
  if (!isLocal) {
    const skills = listSkillsSafe()
    if (skills.length) {
      sys += `\n\n## Skills\n\nThe user has installed skills — reusable instruction sets for specific tasks. When a request matches a skill's description, call the use_skill tool with its slug FIRST, then follow the loaded instructions. If the user types /<slug>, that's an explicit invocation. Available:\n`
      for (const sk of skills) {
        sys += `\n- ${sk.slug}${sk.name !== sk.slug ? ` (${sk.name})` : ''}${sk.description ? ` — ${sk.description}` : ''}`
      }
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

// ── Sub-agents (v0.4.5) ────────────────────────────────────────────────────
// A "spawn_subagent" tool that runs a focused, self-contained task in a NESTED
// chat loop (same provider/model/workspace, fresh context, its own tool budget)
// and returns a final report as the tool result — Claude Code's Task/sub-agent
// pattern. Offered only at the top level (depth 0): a sub-agent never gets the
// spawn tool itself, so recursion can't run away. Lets the parent agent fan a
// big job into bounded pieces ("audit auth", "write the tests") without
// drowning its own context in intermediate tool output.
const SUBAGENT_TOOLS = [
  { type: 'function', function: {
    name: 'spawn_subagent',
    description: 'Delegate a focused, self-contained sub-task to a fresh autonomous agent that has the same file/command tools scoped to this workspace. It works on its own (no user interaction) and returns a concise report. Use this to parallelize or isolate a chunk of a larger task (e.g. "investigate how routing works and summarize", "write unit tests for src/auth.js"). The sub-agent cannot spawn further sub-agents. Give it everything it needs in the prompt — it does NOT see this conversation.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'A short 3-6 word label for the sub-task (shown to the user).' },
        prompt: { type: 'string', description: 'The full, self-contained instruction for the sub-agent. Include all context, file paths, and what to return — it has no memory of this chat.' },
      },
      required: ['description', 'prompt'],
    },
  } },
]

// ── Folder skills (v0.8) ──────────────────────────────────────────────────
// Skills follow the SKILL.md folder convention (~/.labaik/skills/<slug>/).
// The system prompt lists name + description only; the body enters context
// ONLY when the model calls use_skill — Claude Code's selective-loading
// pattern, so 30 installed skills don't cost 30 bodies of tokens per turn.
// The tool is offered whenever at least one skill exists (no workspace
// needed — skills are user-global).
const SKILL_TOOLS = [
  { type: 'function', function: {
    name: 'use_skill',
    description: 'Load the full instructions of an installed skill by slug. The available skills are listed in the system prompt under "## Skills". Call this when the user\'s request matches a skill\'s description (or they name it with /slug), then follow the returned instructions for the rest of the turn.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The skill slug exactly as listed in the system prompt.' },
      },
      required: ['slug'],
    },
  } },
]

// List skills fresh per turn (cheap fs scan; user can drop a folder in and
// use it on the next message). Returns [] on any failure.
function listSkillsSafe() {
  try { return folderSkills.discover() } catch { return [] }
}

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
  { type: 'function', function: { name: 'browser_navigate', description: 'Open or navigate a Chromium browser window to the given URL. ONLY use when the user explicitly asks you to visit a specific URL, look something up online, or interact with a webpage. Do NOT use for general research, package lookup, documentation reading, or speculative browsing — write your answer from your training and ask the user if they want a live lookup. Only http(s) allowed.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browser_get_text', description: 'Read the text content of the current page, or of a specific CSS selector. Returns up to 20,000 characters. Only useful AFTER browser_navigate has been called for a specific user-requested URL.', parameters: { type: 'object', properties: { selector: { type: 'string' } } } } },
  { type: 'function', function: { name: 'browser_click', description: 'Click an element in the current page (buttons, links). Selector must be a CSS query. Only used when interacting with a page the user explicitly asked you to drive.', parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } } },
  { type: 'function', function: { name: 'browser_fill', description: 'Type into an input / textarea / contenteditable element. Fires input + change events. Only used when interacting with a page the user explicitly asked you to drive.', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] } } },
  { type: 'function', function: { name: 'browser_screenshot', description: 'Capture the current browser window as a PNG. Returns base64 + mime. For debugging or showing the user what the page looks like.', parameters: { type: 'object', properties: {} } } },
]

// v0.7.72 — Browser-tools gating. The system prompt already says "browser
// tools are opt-in", but reasoning models (DeepSeek V4 with thinking,
// o1/o3, etc) sometimes call them speculatively anyway, e.g.
// `browser_navigate("about:blank")` to "warm up" before a build task that
// has nothing to do with browsing. The user sees a popped browser window
// they didn't ask for and an `about:blank` chip in the activity stream.
//
// Cleaner fix: don't even OFFER browser tools to the model unless the
// user's most recent message signals browser intent. Detection looks for
// either an explicit http(s) URL or a small set of unambiguous keywords.
// False negative (user wanted browser, didn't trip heuristic) → user can
// rephrase. False positive (model still misuses) → executor-side URL
// guard below catches the worst cases.
function userWantsBrowserIntent(messages) {
  if (!Array.isArray(messages)) return false
  // Only the latest user message matters — earlier turns don't justify
  // re-exposing browser tools forever. Walk backwards to the most recent
  // role:'user' entry.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    let text = ''
    if (typeof m.content === 'string') text = m.content
    else if (Array.isArray(m.content)) {
      text = m.content.filter(p => p?.type === 'text').map(p => p.text || '').join(' ')
    }
    if (!text) return false
    text = text.toLowerCase()
    // Strong: explicit http(s) URL.
    if (/https?:\/\/\S+/.test(text)) return true
    // Strong: unambiguous browse-the-web keywords.
    // "browse", "navigate to" + url-ish noun, "look up online", "search the web",
    // "scrape", "fetch the page", "open <a website>", "the URL".
    if (/\b(browse|navigate to|look (it|that|this) up online|look up online|search the web|scrape|fetch the page|open the (url|link|page|site|website))\b/.test(text)) return true
    // The literal word "browser" almost always implies the tool.
    if (/\bbrowser\b/.test(text)) return true
    return false
  }
  return false
}

// v0.8 market-fit: screen-control gating. screen_click/type/key operate the
// user's REAL desktop — offering them in every chat let any model
// speculatively click around outside the app. Same pattern as browser
// tools: only offer when the latest user message signals screen intent.
function userWantsScreenIntent(messages) {
  if (!Array.isArray(messages)) return false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    let text = ''
    if (typeof m.content === 'string') text = m.content
    else if (Array.isArray(m.content)) {
      text = m.content.filter(p => p?.type === 'text').map(p => p.text || '').join(' ')
    }
    if (!text) return false
    text = text.toLowerCase()
    if (/\b(my screen|on (the |my )?screen|screenshot|screen ?shot|control (my |the )?(mac|desktop|computer)|click (on |the )|press (the )?\w+ (button|key)|type (into|in) )/.test(text)) return true
    return false
  }
  return false
}

// ── Web search (v0.8 cycle 20) ─────────────────────────────────────────────
// Lightweight, headless web access for EVERY model — the everyday "what's
// the latest…" capability without popping the Chromium browser window.
// DuckDuckGo's HTML endpoint needs no API key; LABAIK_SEARCH_BASE lets the
// test fixture point at a mock. fetch_page returns readable text with an
// SSRF guard (no localhost / private ranges / non-http schemes).
const SEARCH_TOOLS = [
  { type: 'function', function: {
    name: 'web_search',
    description: 'Search the web. Use ONLY when the answer genuinely needs current or external information (news, prices, weather, recent releases, facts after your training cutoff). Do not search for things you already know. Returns titles, URLs, and snippets — follow up with fetch_page on the most promising result when the snippet is not enough.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query — keep it short and specific.' } }, required: ['query'] },
  } },
  { type: 'function', function: {
    name: 'fetch_page',
    description: 'Fetch a web page and return its readable text (scripts/markup stripped, capped at 20KB). Use after web_search to read a result, or when the user gives a URL.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL to fetch.' } }, required: ['url'] },
  } },
]

function _blockedUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return 'invalid URL' }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only http(s) allowed'
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return 'local addresses blocked'
  if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(h)) return 'private addresses blocked'
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return 'private addresses blocked'
  return null
}

async function runWebSearch(query) {
  const q = String(query || '').trim()
  if (!q) return { error: 'web_search requires a query.' }
  const base = process.env.LABAIK_SEARCH_BASE || 'https://html.duckduckgo.com'
  let html
  try {
    const res = await fetch(`${base}/html/?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Labaik' }, redirect: 'follow',
    })
    if (!res.ok) return { error: `Search failed: HTTP ${res.status}` }
    html = await res.text()
  } catch (err) {
    return { error: `Search failed: ${err.message}` }
  }
  const results = []
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const strip = (x) => x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
  const snippets = []
  let m
  while ((m = snipRe.exec(html)) !== null) snippets.push(strip(m[1]))
  let i = 0
  while ((m = linkRe.exec(html)) !== null && results.length < 5) {
    let url = m[1]
    // DDG wraps result hrefs: //duckduckgo.com/l/?uddg=<encoded>&rut=…
    const uddg = /[?&]uddg=([^&]+)/.exec(url)
    if (uddg) { try { url = decodeURIComponent(uddg[1]) } catch {} }
    results.push({ title: strip(m[2]), url, snippet: snippets[i] || '' })
    i++
  }
  if (!results.length) return { results: [], note: 'No results parsed — try a different query.' }
  return { results }
}

async function runFetchPage(rawUrl) {
  const blocked = _blockedUrl(rawUrl)
  if (blocked) return { error: `Blocked: ${blocked}` }
  let res, html
  try {
    res = await fetch(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Labaik' }, redirect: 'follow' })
    if (!res.ok) return { error: `Fetch failed: HTTP ${res.status}` }
    html = await res.text()
  } catch (err) {
    return { error: `Fetch failed: ${err.message}` }
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
  return { url: rawUrl, text: text.slice(0, 20000), truncated: text.length > 20000 }
}

// ── Image generation ──────────────────────────────────────────────────────
// v0.7.72: tool-callable image generation. Same gating discipline as the
// browser tools — only expose to the model when the user's latest message
// signals image intent. Image gen routes through OpenAI's images.generate
// (gpt-image-1 / variants). Output saved to ~/.labaik/images/{id}.png so
// it persists across session reloads without bloating sessions.json.

const IMAGE_TOOLS = [
  { type: 'function', function: {
    name: 'generate_image',
    description: 'Generate an image from a text prompt. ONLY use when the user explicitly asks for an image, picture, drawing, illustration, photo, poster, logo, icon, or visual artwork. Do NOT generate images for tasks where text/code would suffice. The result is saved to disk and rendered inline in the chat.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed visual description. Include subject, style, lighting, composition. Be specific.' },
        size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'Image dimensions. Default 1024x1024 (square). Use 1536x1024 for landscape, 1024x1536 for portrait.' },
        quality: { type: 'string', enum: ['standard', 'high'], description: 'standard = faster/cheaper, high = more detail. Default standard.' },
      },
      required: ['prompt'],
    },
  } },
]

function userWantsImageIntent(messages) {
  if (!Array.isArray(messages)) return false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    let text = ''
    if (typeof m.content === 'string') text = m.content
    else if (Array.isArray(m.content)) {
      text = m.content.filter(p => p?.type === 'text').map(p => p.text || '').join(' ')
    }
    if (!text) return false
    text = text.toLowerCase()
    // Strong, unambiguous image-request keywords. False negative is
    // recoverable; false positive risks the model speculatively spending
    // image-gen credits.
    if (/\b(draw|generate|create|make|design|render|sketch|illustrate|paint)\s+(an?|the|me\s+an?)\s+(image|picture|drawing|illustration|photo|poster|logo|icon|sketch|portrait|painting|graphic|artwork|visual|cover|banner|wallpaper|avatar|mockup|scene|landscape)/i.test(text)) return true
    if (/\b(image|picture|illustration|photo|poster|logo|icon|drawing|sketch|painting|portrait|graphic|artwork)\s+of\s+/i.test(text)) return true
    if (/\b(visualize|visualise|show me|imagine)\s+(an?|the)?\s*(image|picture|scene|view)/i.test(text)) return true
    return false
  }
  return false
}


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
  // v0.4.0: Observe mode is read-only — a cheap inline backstop. The full
  // gate (prompt / allow-list / rule resolution) runs in main via the
  // approval bridge below (v0.4.1).
  const WRITE_TOOLS = new Set(['write_file', 'run_command', 'open_in_browser', 'start_dev_server',
    'browser_navigate', 'browser_click', 'browser_fill',
    'screen_click', 'screen_type', 'screen_key', 'screen_move_mouse'])
  if (mode === 'observe' && WRITE_TOOLS.has(name)) {
    return { error: `Observe mode is read-only. Switch to Careful, Flow, or Autopilot (Shift+Tab) to enable ${name}.` }
  }

  // v0.4.1: approval gate. Side-effecting filesystem/command tools route
  // through main, which owns the permission rules AND the window that can
  // ask the user. Main runs permissions.resolveGate(); if the verdict is
  // 'prompt' it shows the approval dialog and waits for the user. We only
  // gate the write/exec/open tools here — reads stay on the fast path, and
  // browser_/screen_/mcp_ tools have their own gating downstream.
  const GATED_TOOLS = new Set(['write_file', 'run_command', 'start_dev_server', 'open_in_browser'])
  if (GATED_TOOLS.has(name)) {
    const gate = await requestApproval({ tool: name, args: args || {}, workspacePath, summary: summarizeArgs(name, args) })
    if (gate && gate.verdict && gate.verdict !== 'allow') {
      return { error: gate.message || `Blocked: "${name}" was not approved. Ask the user to allow it, or switch permission mode.` }
    }
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
  // v0.7.72: image generation. Routes through OpenAI's images API.
  // Saves the result to ~/.labaik/images/{id}.png and emits an
  // image_generated activity event so the renderer can attach the
  // image to the streaming bubble. Returns a brief success/error
  // string to the model so it can compose its text reply.
  if (name === 'generate_image') {
    return await runImageGen(args || {})
  }
  // v0.8: folder skills — load a SKILL.md body on demand. Read-only, global
  // (no workspace required), so it stays outside the approval gate.
  if (name === 'web_search') return await runWebSearch(args?.query)
  if (name === 'fetch_page') return await runFetchPage(args?.url)
  if (name === 'use_skill') {
    const skill = folderSkills.get(String(args?.slug || '').trim())
    if (!skill) {
      const known = listSkillsSafe().map(s => s.slug).join(', ') || '(none installed)'
      return { error: `No skill with slug "${args?.slug}". Installed skills: ${known}` }
    }
    return { name: skill.name, instructions: skill.body }
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

function shouldHeartbeatProviderWait(provider, model) {
  return provider === 'deepseek' || /reasoner|thinking|^o[13]|^gpt-5.*think/i.test(model || '')
}

// Some reasoning providers accept a streaming request, then stay quiet before
// the first SSE chunk. Tell main the worker is alive while the hard cap remains
// responsible for truly wedged calls.
async function withProviderWaitHeartbeat(provider, model, onActivity, fn) {
  if (!shouldHeartbeatProviderWait(provider, model)) return await fn()

  const ping = () => {
    try { onActivity({ phase: 'provider_wait', provider, model }) } catch {}
  }
  ping()
  const timer = setInterval(ping, 25 * 1000)
  if (typeof timer.unref === 'function') timer.unref()

  try {
    return await fn()
  } finally {
    clearInterval(timer)
  }
}

function buildChatCompletionParams({ provider, model, messages, stream, tools, suppressThinking }) {
  const isDeepSeek = provider === 'deepseek'
  const isDeepSeekV4 = isDeepSeek && /^deepseek-v4-/i.test(model || '')
  const maxTokens = isDeepSeek ? 32768 : 4096
  return {
    model,
    messages,
    ...(isDeepSeek ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
    ...(stream ? { stream: true } : {}),
    ...(tools ? { tools } : {}),
    ...(suppressThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    ...(isDeepSeekV4 ? { reasoning_effort: 'high', thinking: { type: 'enabled' } } : {}),
  }
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

// v0.4.1: approval bridge. Unlike the other bridges this can block on a
// HUMAN, so it gets its own long timeout (10 min, then auto-deny) and
// carries the chat request id so main can keep that request alive while
// the dialog is open instead of tripping the idle timer.
const _pendingApprovals = new Map()
function requestApproval(detail) {
  const id = 'ap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  const chatId = _inFlightRequest?.id ?? null
  try { process.stdout.write(JSON.stringify({ type: 'approval', id, chatId, ...detail }) + '\n') } catch {}
  return new Promise((resolve) => {
    _pendingApprovals.set(id, resolve)
    const t = setTimeout(() => {
      if (_pendingApprovals.has(id)) {
        _pendingApprovals.delete(id)
        resolve({ verdict: 'deny', message: 'Approval timed out — no response after 10 minutes.' })
      }
    }, 10 * 60 * 1000)
    if (typeof t.unref === 'function') t.unref()
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
  if (name === 'spawn_subagent') return String(args.description || 'task').slice(0, 80)
  if (name === 'web_search') return String(args.query || '').slice(0, 80)
  if (name === 'fetch_page') return String(args.url || '').slice(0, 80)
  return ''
}

// v0.7.67 — plan-mode addition. Appended to the system prompt when the
// renderer requests plan mode. Tells the model to write a plan only and
// NOT to execute. We also strip the workspace tools below so the model
// physically cannot call write_file / run_command even if it tried.
// v0.8 cycle 21 — Deep Research mode. Appended when the renderer sends
// researchMode: the model runs a multi-search, cross-checked, fully cited
// investigation using web_search/fetch_page inside its normal tool loop.
const RESEARCH_PROMPT_ADDITION = `

## DEEP RESEARCH MODE — follow this protocol exactly

The user wants a researched, cited answer — not what you remember.

1. PLAN: break the question into 2-4 sub-questions.
2. SEARCH: run web_search for each (differently-angled queries, not
   rephrasings). Batch tool calls where possible.
3. READ: fetch_page the 2-4 most authoritative results — primary sources
   over aggregators, recent over stale.
4. CROSS-CHECK: where sources disagree, say so explicitly.
5. DELIVER:
   - **TL;DR** — 2-3 sentences.
   - **Findings** — with inline [1][2] citations on every load-bearing claim.
   - **Sources** — numbered list with URLs and publication dates if known.
   - **Caveats** — what could not be verified, what is contested, how fresh
     the data is.

Never invent citations. A claim without a source goes in Caveats, labeled
as your prior knowledge.`

const PLAN_MODE_PROMPT_ADDITION = `

## PLAN MODE — read this before responding

You are in plan mode. The user wants a step-by-step plan, NOT execution.

Rules:
1. Do NOT call any tools. Do NOT write files. Do NOT run commands.

2. **Resolve ambiguity FIRST with structured questions.** Before producing
   a plan, look at the request: are there choices a user would reasonably
   want to weigh in on? (framework, library, database, naming, scope,
   etc.) If yes, emit a SINGLE \`\`\`ask\`\`\` block containing ALL the
   questions you need answered (use the multi-question schema with the
   \`questions\` array — see "Asking the user clarifying questions" above).

   Hard ceiling: 3 questions per ask-block. 1-2 is better. Pick the most
   important decisions; if you genuinely need more info later, ask once
   and then plan with reasonable defaults for the rest.

   Always mark exactly ONE option per question as recommended.

   If the user clicks "Skip — use defaults" on the popup, proceed directly
   to producing the plan with the recommended option as the assumed answer
   for every question. Do NOT re-ask.

3. Output a STRUCTURED PLAN BLOCK using a fenced \`\`\`plan\`\`\` JSON block.
   The renderer turns this into a clean card. **Less is more** — the
   user wants to know WHAT they'll get and WHAT to watch out for, not
   the implementation details.

   Required:
     - headline: 1 line, plain English. The thing being built/done.
     - whatYouGet: 1-2 sentences, USER-FACING outcome. Describe what the
       user will be able to DO when this is done. NOT what you'll do.
     - steps: 3-5 short bullets MAX. Each \`title\` is one short phrase
       (3-7 words). Skip \`detail\` unless something is genuinely
       non-obvious — most steps don't need it.

   Optional (use sparingly):
     - thingsToKnow: 1-3 short lines about gotchas, costs, or trade-offs
       the user should know BEFORE approving. Skip if nothing surprising.
     - files: list of paths you'll touch. The user CARES MOST about the
       outcome, not the file paths — files are hidden behind a "show
       details" toggle by default. Still include them; just keep \`steps\`
       and \`whatYouGet\` non-technical.
     - estimate: rough time, e.g. "~5 min".

   Tone rules:
     - Speak to the user, not about the code. "Login link expires in 15
       min" beats "Set the JWT exp claim to 900 seconds".
     - No jargon unless the user used it first.
     - No file paths in \`whatYouGet\` or step titles. Save those for the
       \`files\` section (which is collapsed by default).

   Good example:

   \`\`\`plan
   {
     "headline": "Add passwordless login",
     "whatYouGet": "Users sign in by entering their email and clicking a magic link. No passwords to manage.",
     "steps": [
       {"title": "Install auth library"},
       {"title": "Add login + verify pages"},
       {"title": "Wire email sending"},
       {"title": "Protect signed-in pages"}
     ],
     "files": [
       {"path": "src/lib/auth.ts", "action": "create"},
       {"path": "src/routes/auth/+page.svelte", "action": "create"},
       {"path": "src/hooks.server.ts", "action": "modify"}
     ],
     "thingsToKnow": [
       "Needs a Resend API key (free for 3,000 emails/mo)",
       "Login links are single-use and expire in 15 minutes"
     ],
     "estimate": "~20 min"
   }
   \`\`\`

   Bad example (too technical, files leaking into steps):

   \`\`\`plan
   {
     "headline": "Set up @lucia-auth/lucia with Drizzle adapter",
     "whatYouGet": "Implement Lucia v3 sessions backed by sessions table",
     "steps": [
       {"title": "Update package.json with @lucia-auth/lucia ^3.2", "detail": "..."},
       {"title": "Configure auth.ts to import lucia + drizzleAdapter", "detail": "..."}
     ]
   }
   \`\`\`

4. After the plan block, end with this exact line: "Reply 'go' or click
   Approve & execute below."

   Do NOT add any other prose after the plan block. The card IS the plan.
   If you have a short note, put it in \`thingsToKnow\`.

The user will review the plan, then either approve it (which lands you
back in normal mode with a "Proceed with the plan above" message) or
ask for changes. Stay in plan mode until they explicitly approve.`

async function handleChat({ messages, model, workspacePath, spacePrompt, id, messageId, mode, planMode, researchMode, signal }) {
  process.stderr.write(`[worker] handleChat called — model="${model}" (type: ${typeof model})\n`)
  let provider = detectProvider(model)
  if (!model) {
    // v0.7.67 — DeepSeek V4 Pro is the new default. Cheaper per token than
    // OpenAI/Anthropic flagships with comparable quality on most tasks.
    // Fallback chain in order of preference if the user lacks the key.
    if (getApiKey('deepseek')) { provider = 'deepseek'; model = 'deepseek-v4-pro' }
    else if (getApiKey('anthropic')) { provider = 'anthropic'; model = 'claude-sonnet-4-6' }
    else if (getApiKey('openai')) { provider = 'openai'; model = 'gpt-4o' }
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

  // v0.4.4 — inline any @-mentioned workspace files into the latest user turn
  // so the model sees their contents (computed AFTER lastUserText so file
  // bodies don't skew rich-intent detection).
  try { expandFileMentions(messages, workspacePath) } catch (e) { try { console.error('[worker] mention expand failed:', e.message) } catch {} }

  let sysPrompt = buildSystemPrompt({
    provider,
    model,
    workspacePath,
    spacePrompt,
    userText: lastUserText,
  })
  // v0.7.67 — plan mode swaps in a "produce a plan, don't execute" addendum.
  // Tools are also disabled below by passing skipTools=true into the chat
  // routes that respect it. Belt + suspenders: prompt says don't, code
  // can't.
  if (planMode) {
    sysPrompt += PLAN_MODE_PROMPT_ADDITION
    process.stderr.write(`[worker] plan mode active for messageId=${messageId}\n`)
  }
  if (researchMode) {
    sysPrompt += RESEARCH_PROMPT_ADDITION
    process.stderr.write(`[worker] deep-research mode active for messageId=${messageId}\n`)
  }

  // Wrap every activity event with the renderer messageId so the renderer can
  // route tokens to the right lane in council / multi-model mode.
  const onActivity = (activity) => emitActivity(id, { ...activity, messageId })

  if (provider === 'anthropic') {
    return await chatAnthropic(messages, model, workspacePath, sysPrompt, { onActivity, mode, planMode, signal })
  } else if (provider === 'google') {
    return await chatGemini(messages, model, sysPrompt)
  } else if (provider === 'ollama') {
    // Plan mode forces skipTools=true regardless of model — even a thinking
    // model with tools available shouldn't be able to physically call them
    // while planning.
    const skipTools = planMode || shouldSkipToolsForLocal(model)
    const normalised = normalizeModelId(model)
    // Thinking models (Qwen 3, DeepSeek-R1, QwQ) get Ollama's native /api/chat
    // endpoint because OpenAI-compat silently drops chat_template_kwargs.
    // Measured: "hi" reply dropped from 48s → 0.7s by switching endpoints.
    if (isThinkingLocalModel(normalised)) {
      return await chatOllamaNative(messages, normalised, workspacePath, sysPrompt, { skipTools, onActivity, mode, signal })
    }
    return await chatOpenAI(messages, normalised, provider, workspacePath, sysPrompt, { skipTools, onActivity, mode, signal })
  } else {
    // v0.7.61: strip any routing-hint prefix (e.g. `kimi-intl/`) so the
    // SDK sees the raw upstream model id. Case is preserved — MiniMax
    // and other case-sensitive providers need `MiniMax-M2.7` unchanged.
    return await chatOpenAI(messages, normalizeModelId(model), provider, workspacePath, sysPrompt, { onActivity, mode, skipTools: planMode, signal })
  }
}

// v0.7.72 — Image generation tool runner. Routes through OpenAI's
// images.generate (gpt-image-1). Saves PNG to ~/.labaik/images/{id}.png
// so the renderer can attach a stable file:// reference to the message
// without bloating sessions.json with base64. Emits image_generated
// activity so the renderer adds the image to the streaming target's
// fileEdits-style record (new field: msg.imagesGenerated).
let _imgActivityCb = null
function setImageActivity(cb) { _imgActivityCb = cb }

async function runImageGen(args) {
  const apiKey = getApiKey('openai')
  if (!apiKey) {
    return { error: 'No OpenAI API key configured. Image generation needs the openai key. Open Keys modal (⌘⇧K) → add the OpenAI key, then try again.' }
  }
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return { error: 'generate_image requires a prompt.' }
  const size = ['1024x1024', '1536x1024', '1024x1536'].includes(args.size) ? args.size : '1024x1024'
  const quality = args.quality === 'high' ? 'high' : 'standard'

  const OpenAI = require('openai').default || require('openai')
  const client = new OpenAI({ apiKey, timeout: 120000 })  // image gen takes 5-30s
  let resp
  try {
    resp = await client.images.generate({
      model: 'gpt-image-1',
      prompt,
      size,
      quality,
      n: 1,
      response_format: 'b64_json',
    })
  } catch (err) {
    return { error: `Image generation failed: ${err?.message || String(err)}` }
  }
  const b64 = resp?.data?.[0]?.b64_json
  if (!b64) return { error: 'OpenAI returned no image data.' }

  // Save to ~/.labaik/images/{id}.png (honors LABAIK_HOME via paths.BASE_DIR)
  const imagesDir = path.join(paths.BASE_DIR, 'images')
  try { fs.mkdirSync(imagesDir, { recursive: true }) } catch {}
  const id = 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  const filePath = path.join(imagesDir, `${id}.png`)
  try {
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'))
  } catch (err) {
    return { error: `Failed to save image to disk: ${err?.message || String(err)}` }
  }

  // Tell the renderer to attach this image to the active message.
  if (_imgActivityCb) {
    try { _imgActivityCb({ phase: 'image_generated', path: filePath, prompt, size, quality }) } catch {}
  }

  return {
    success: true,
    path: filePath,
    size,
    quality,
    prompt,
    note: 'Image saved and rendered inline. Acknowledge briefly in your reply (one short sentence).',
  }
}

async function chatOpenAI(msgs, model, provider, workspacePath, sysPrompt, opts = {}) {
  const { skipTools = false, onActivity = () => {}, mode = 'autopilot', depth = 0, signal = null } = opts
  // v0.7.72: route image-gen activity events to this turn's onActivity.
  setImageActivity(onActivity)
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
  // v0.7.72: gate browser tools by user intent. Drops them from the tool
  // list entirely when the latest user message has no URL / no browse
  // keywords. Stops the model from speculatively popping a browser window
  // for tasks that don't need it.
  const offerBrowser = !skipTools && userWantsBrowserIntent(msgs)
  const offerImage = !skipTools && userWantsImageIntent(msgs)
  const offerScreen = !skipTools && userWantsScreenIntent(msgs)
  const allTools = skipTools ? [] : [
    ...(workspacePath ? TOOLS : []),
    // Sub-agents only at the top level + when a workspace is open. A spawned
    // sub-agent (depth > 0) never sees this tool, so it can't recurse.
    ...((workspacePath && depth === 0) ? SUBAGENT_TOOLS : []),
    ...(offerBrowser ? BROWSER_TOOLS : []),
    ...(offerImage ? IMAGE_TOOLS : []),
    ...(offerScreen ? SCREEN_TOOLS : []),  // v0.8: gated on screen intent
    ...(listSkillsSafe().length ? SKILL_TOOLS : []),  // v0.8: folder skills
    ...SEARCH_TOOLS,      // v0.8: web search for every model
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
    // v0.8: user pressed Stop — return what we have instead of starting
    // another provider round.
    if (signal?.aborted) { fullText += '\n\n⏹ Stopped.'; break }
    // Hoisted so the Stop path below can salvage tokens that streamed in
    // before the abort landed.
    let iterContent = ''
    try {
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
      await withProviderWaitHeartbeat(provider, model, onActivity, async () => {
        const stream = await client.chat.completions.create(buildChatCompletionParams({
          provider,
          model,
          messages: chatMsgs,
          stream: true,
          tools: useTools,
          suppressThinking,
        }), signal ? { signal } : undefined)
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
      })
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
      // v0.8: user pressed Stop — salvage whatever streamed in, no fallback.
      if (signal?.aborted) {
        fullText += iterContent + '\n\n⏹ Stopped.'
        break
      }
      // Streaming not supported or failed — fall back to non-streaming on this iteration only
      process.stderr.write(`[worker] streaming failed (${streamErr.message}) — falling back to non-streaming\n`)
      const res = await withProviderWaitHeartbeat(provider, model, onActivity, () => client.chat.completions.create(buildChatCompletionParams({
        provider,
        model,
        messages: chatMsgs,
        tools: useTools,
        suppressThinking,
      })))
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
        // v0.4.5 — sub-agent delegation runs a nested chatOpenAI loop instead
        // of going through executeToolCall (it needs provider/model/depth).
        let result
        if (tc.function.name === 'spawn_subagent') {
          result = await runSubAgent(args, { model, provider, workspacePath, mode, depth, onActivity })
        } else {
          result = await executeToolCall(tc.function.name, args, workspacePath, mode)
        }
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
        else if (tc.function.name === 'spawn_subagent') { toolLog += `\n🤖 Sub-agent: ${args.description || 'task'}` }
        chatMsgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }
      continue
    }
    break
  }
  // Screen response for health red flags
  if (signal?.aborted && !fullText.includes('⏹ Stopped')) fullText += '\n\n⏹ Stopped.'
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

// v0.4.5 — run a delegated sub-task in a nested chatOpenAI loop and return a
// report object the parent agent gets as the spawn_subagent tool result.
//   - depth+1 so the sub-agent never gets the spawn tool (no runaway recursion).
//   - same provider/model/workspace/mode → approvals & scope guards still apply.
//   - fresh message array + a sub-agent system role; it does NOT see the parent
//     conversation (the parent must put everything in `prompt`).
//   - sub-agent token/reasoning streams are NOT forwarded to the renderer (they
//     would interleave into the parent's bubble); tool_start/tool_end/file_edit
//     ARE forwarded (tagged subagent:true) so progress chips still show.
async function runSubAgent(args, ctx) {
  const { model, provider, workspacePath, mode, depth = 0, onActivity = () => {} } = ctx || {}
  const description = String(args?.description || 'sub-task').slice(0, 120)
  const prompt = String(args?.prompt || '').trim()
  if (!prompt) return { error: 'spawn_subagent requires a non-empty prompt.' }
  if (depth >= 1) return { error: 'Sub-agents cannot spawn further sub-agents.' }

  let sysPrompt = buildSystemPrompt({ provider, model, workspacePath, spacePrompt: '', userText: prompt })
  sysPrompt += `\n\n## You are a sub-agent\n\nYou were delegated a focused, self-contained task by another agent. Work autonomously — you cannot ask the user questions and you do not see the parent conversation. Use your tools to complete the task fully, then end with a concise report of what you did, what you found, and any file paths or results the parent agent needs. Be thorough but do not pad the report.`

  const subActivity = (a) => {
    if (!a || a.phase === 'token' || a.phase === 'reasoning_token') return
    try { onActivity({ ...a, subagent: true, subagentLabel: description }) } catch {}
  }

  process.stderr.write(`[worker] spawning sub-agent "${description}" (depth ${depth + 1}, provider ${provider})\n`)
  const subMsgs = [{ role: 'user', content: prompt }]
  const subOpts = { onActivity: subActivity, mode, depth: depth + 1 }
  try {
    // Run the sub-agent on the parent's provider so it inherits the same model
    // behavior + credentials. Both paths honor `depth` to withhold the spawn
    // tool from the child.
    const text = provider === 'anthropic'
      ? await chatAnthropic(subMsgs, model, workspacePath, sysPrompt, subOpts)
      : await chatOpenAI(subMsgs, model, provider, workspacePath, sysPrompt, subOpts)
    return { success: true, description, report: String(text || '').slice(0, 20000) }
  } catch (e) {
    return { error: `Sub-agent "${description}" failed: ${e.message || String(e)}` }
  }
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
  const { skipTools = false, onActivity = () => {}, mode = 'autopilot', signal = null } = opts
  setImageActivity(onActivity)
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
  // v0.7.72: same browser-intent gating as chatOpenAI above.
  const offerBrowser = !skipTools && userWantsBrowserIntent(msgs)
  const offerImage = !skipTools && userWantsImageIntent(msgs)
  const offerScreen = !skipTools && userWantsScreenIntent(msgs)
  const allTools = skipTools ? [] : [
    ...(workspacePath ? TOOLS : []),
    ...(offerBrowser ? BROWSER_TOOLS : []),
    ...(offerImage ? IMAGE_TOOLS : []),
    ...(offerScreen ? SCREEN_TOOLS : []),  // v0.8: gated on screen intent
    ...(listSkillsSafe().length ? SKILL_TOOLS : []),  // v0.8: folder skills
    ...SEARCH_TOOLS,      // v0.8: web search for every model
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
        ...(signal ? { signal } : {}),
      })
    } catch (netErr) {
      // v0.8: user pressed Stop.
      if (signal?.aborted) { fullText += '\n\n⏹ Stopped.'; break }
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
    let _stopped = false
    while (true) {
      let done, value
      try { ({ done, value } = await reader.read()) }
      catch (e) {
        // v0.8: abort mid-stream — keep what we have.
        if (signal?.aborted) { _stopped = true; break }
        throw e
      }
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
    if (_stopped) { fullText += '\n\n⏹ Stopped.'; break }
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
  if (signal?.aborted && !fullText.includes('⏹ Stopped')) fullText += '\n\n⏹ Stopped.'
  return fullText || '(no response)'
}

async function chatAnthropic(msgs, model, workspacePath, sysPrompt, opts = {}) {
  const { onActivity = () => {}, mode = 'autopilot', planMode = false, depth = 0, signal = null } = opts
  setImageActivity(onActivity)
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
  // v0.7.67 — plan mode strips ALL tools so the model physically can't act.
  const mcpTools = planMode ? [] : await getMcpTools().catch(() => [])
  // v0.7.72: gate browser tools by user intent (same heuristic as the
  // OpenAI/Ollama paths). Plan mode already strips everything anyway.
  const offerBrowser = !planMode && userWantsBrowserIntent(msgs)
  const offerScreen = !planMode && userWantsScreenIntent(msgs)
  const offerImage = !planMode && userWantsImageIntent(msgs)
  const allAnthTools = planMode ? [] : [...(workspacePath ? TOOLS : []), ...((workspacePath && depth === 0) ? SUBAGENT_TOOLS : []), ...(offerBrowser ? BROWSER_TOOLS : []), ...(offerImage ? IMAGE_TOOLS : []), ...(offerScreen ? SCREEN_TOOLS : []), ...(listSkillsSafe().length ? SKILL_TOOLS : []), ...SEARCH_TOOLS, ...mcpTools, ...(isHealthSpace ? HEALTH_TOOLS : [])]
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
    // v0.8: user pressed Stop — don't start another provider round.
    if (signal?.aborted) { fullText += '\n\n⏹ Stopped.'; break }
    let res
    let _anthPartial = ''
    try {
      const stream = client.messages.stream({
        model, max_tokens: 4096, system: sysPrompt, messages: chatMsgs,
        ...(anthTools ? { tools: anthTools } : {}),
      }, signal ? { signal } : undefined)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          _anthPartial += event.delta.text
          onActivity({ phase: 'token', text: event.delta.text })
        }
      }
      res = await stream.finalMessage()
    } catch (streamErr) {
      // v0.8: abort mid-stream — salvage tokens that already arrived.
      if (signal?.aborted) { fullText += _anthPartial + '\n\n⏹ Stopped.'; break }
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
        // v0.4.5 — sub-agent delegation runs a nested loop (see runSubAgent).
        let result
        if (tu.name === 'spawn_subagent') {
          result = await runSubAgent(tu.input, { model, provider: 'anthropic', workspacePath, mode, depth, onActivity })
        } else {
          result = await executeToolCall(tu.name, tu.input, workspacePath, mode)
        }
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
        else if (tu.name === 'spawn_subagent') { toolLog += `\n🤖 Sub-agent: ${tu.input.description || 'task'}` }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
      }
      chatMsgs.push({ role: 'user', content: results })
      continue
    }
    break
  }
  if (signal?.aborted && !fullText.includes('⏹ Stopped')) fullText += '\n\n⏹ Stopped.'
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
      // v0.4.1: approval verdict coming back from main (after the dialog or
      // an instant allow/deny from resolveGate).
      if (req.type === 'approval-response') {
        const resolver = _pendingApprovals.get(req.id)
        if (resolver) { _pendingApprovals.delete(req.id); resolver({ verdict: req.verdict, message: req.message }) }
        continue
      }
      // v0.8: stop generation. Abort the in-flight provider stream for this
      // chat id — the chat then resolves normally with the partial text.
      if (req.type === 'chat-cancel') {
        const ac = _activeAborts.get(req.id)
        if (ac) { try { ac.abort() } catch {} }
        continue
      }
      _inFlightRequest = { id: req.id }
      const _ac = new AbortController()
      _activeAborts.set(req.id, _ac)
      handleChat({ ...req, signal: _ac.signal })
        .then(result => {
          _inFlightRequest = null
          _activeAborts.delete(req.id)
          process.stdout.write(JSON.stringify({ id: req.id, result }) + '\n')
        })
        .catch(err => {
          _inFlightRequest = null
          _activeAborts.delete(req.id)
          process.stdout.write(JSON.stringify({ id: req.id, error: formatErrorForUser(err) }) + '\n')
        })
    } catch (err) {
      process.stdout.write(JSON.stringify({ error: 'Invalid JSON: ' + err.message }) + '\n')
    }
  }
})
