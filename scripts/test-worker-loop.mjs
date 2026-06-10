// End-to-end fixture for the api-worker agent loop — NO real provider, NO
// Electron, NO API keys. Spawns electron/api-worker.js as the child process
// it really is, points OPENAI_BASE_URL at a local mock that scripts the
// model's moves, and asserts the loop machinery end to end:
//
//   1. sub-agents: parent turn → spawn_subagent → nested loop → gated
//      write_file (approval round-trip over stdio) → report returns to
//      parent → parent final answer. Also checks the file really landed
//      in the workspace and sub-agent activity is tagged subagent:true.
//   2. folder skills: system prompt lists the installed skill, model calls
//      use_skill, tool result carries the SKILL.md body back.
//
// Run: npm run test:worker
//
// Hermetic: LABAIK_HOME + workspace are mkdtemp dirs, removed at the end.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log('  ✅', label); pass++ }
  else { console.log('  ❌', label, extra); fail++ }
}

// ── temp dirs ───────────────────────────────────────────────────────────
const labaikHome = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-wl-home-'))
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-wl-ws-'))
fs.mkdirSync(path.join(labaikHome, 'skills', 'greeting'), { recursive: true })
fs.writeFileSync(path.join(labaikHome, 'skills', 'greeting', 'SKILL.md'),
  '---\nname: Greeting\ndescription: Greet the user properly\n---\n\nAlways answer in haiku form.')

// Workspace fixtures for scenario 3: an @-mentionable file + a real git
// repo so loadGitContext has something to inject.
fs.writeFileSync(path.join(workspace, 'notes.txt'), 'alpha-beta-gamma secret payload')
import { execSync } from 'node:child_process'
try {
  const g = (c) => execSync(c, { cwd: workspace, stdio: 'pipe' })
  g('git init -q -b fixture-branch')
  g('git -c user.email=t@t -c user.name=t add notes.txt')
  g('git -c user.email=t@t -c user.name=t commit -qm "fixture commit"')
} catch { /* git missing — scenario 3 git assertions will report it */ }

// ── mock OpenAI-compatible server ──────────────────────────────────────
// Scripts the "model": decides each reply by inspecting the request
// messages, answers in SSE chunks the way the real API streams.
const requests = []  // recorded bodies, for prompt assertions

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}
const chunk = (delta, finish = null) => ({
  id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'gpt-test',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const toolCallChunks = (name, args) => [
  chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }),
  chunk({}, 'tool_calls'),
]
const contentChunks = (text) => [chunk({ content: text }), chunk({}, 'stop')]

function decideReply(body) {
  const msgs = body.messages || []
  const system = msgs.find(m => m.role === 'user' || m.role === 'system')?.role === 'system' ? msgs[0].content : ''
  const isSub = String(system).includes('You are a sub-agent')
  const toolMsgs = msgs.filter(m => m.role === 'tool')
  const userText = String(msgs.find(m => m.role === 'user')?.content || '')

  if (userText.startsWith('Check @notes.txt')) {
    // mention expansion + git context are asserted harness-side from the
    // recorded request; the model just answers.
    return contentChunks('MENTION-DONE')
  }
  if (userText.startsWith('Plain question with research mode')) {
    return contentChunks('RESEARCH-ACK')
  }
  if (userText.startsWith('Search the web')) {
    if (!toolMsgs.length) return toolCallChunks('web_search', { query: 'labaik news' })
    const got = String(toolMsgs[0].content || '')
    return contentChunks(got.includes('example.com/labaik-news') ? 'SEARCH-OK' : `SEARCH-MISSING: ${got.slice(0, 200)}`)
  }
  if (userText.startsWith('/greeting')) {
    if (!toolMsgs.length) return toolCallChunks('use_skill', { slug: 'greeting' })
    const got = String(toolMsgs[0].content || '')
    return contentChunks(got.includes('haiku') ? 'SKILL-OK' : `SKILL-MISSING: ${got.slice(0, 200)}`)
  }
  if (isSub) {
    if (!toolMsgs.length) return toolCallChunks('write_file', { path: 'report.txt', content: 'hello-from-subagent' })
    return contentChunks('SUB-REPORT-DONE')
  }
  // parent
  if (!toolMsgs.length) return toolCallChunks('spawn_subagent', {
    description: 'write the report',
    prompt: 'Create report.txt containing hello-from-subagent in the workspace root.',
  })
  const got = String(toolMsgs[0].content || '')
  return contentChunks(got.includes('SUB-REPORT-DONE') ? 'PARENT-OK' : `PARENT-MISSING-REPORT: ${got.slice(0, 200)}`)
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', d => { raw += d })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw) } catch {}
    requests.push({ url: req.url, body })
    if (req.url.startsWith('/html/')) {
      // DDG-style search results page for the web_search tool
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Flabaik-news">Labaik ships v0.8</a>' +
              '<a class="result__snippet" href="#">Labaik adds web search for every model</a>')
      return
    }
    if (!req.url.includes('/chat/completions')) { res.writeHead(404); res.end('{}'); return }
    // Scenario 4 (stop generation): stream one token, then HANG — the
    // connection only closes when the worker aborts it client-side.
    const userText = String((body.messages || []).find(m => m.role === 'user')?.content || '')
    if (userText.startsWith('HANG')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(chunk({ content: 'partial-before-stop ' }))}\n\n`)
      return // no [DONE], no end — hangs until aborted
    }
    sse(res, decideReply(body))
  })
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// ── spawn the worker ────────────────────────────────────────────────────
const worker = spawn('node', [path.join(ROOT, 'electron', 'api-worker.js')], {
  env: {
    ...process.env,
    LABAIK_HOME: labaikHome,
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LABAIK_SEARCH_BASE: `http://127.0.0.1:${port}`,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
worker.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write(d) })

const activities = []
const approvals = []
const finals = new Map()  // chatId -> {result|error}
let outBuf = ''
worker.stdout.on('data', (d) => {
  outBuf += d
  let idx
  while ((idx = outBuf.indexOf('\n')) !== -1) {
    const line = outBuf.slice(0, idx); outBuf = outBuf.slice(idx + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.type === 'approval') {
      approvals.push(msg)
      // auto-allow, like main.js would after resolveGate/dialog
      worker.stdin.write(JSON.stringify({ type: 'approval-response', id: msg.id, verdict: 'allow' }) + '\n')
    } else if (msg.type === 'mcp-list') {
      // main.js normally answers this bridge request; we have no MCP servers
      worker.stdin.write(JSON.stringify({ type: 'mcp-list-response', id: msg.id, tools: [] }) + '\n')
    } else if (msg.activity) {
      activities.push(msg.activity)
    } else if ('result' in msg || 'error' in msg) {
      finals.set(msg.id, msg)
    }
  }
})

function chat(id, content, extra = {}) {
  worker.stdin.write(JSON.stringify({
    id, messageId: `m${id}`, messages: [{ role: 'user', content }],
    model: 'gpt-test-1', workspacePath: workspace, spacePrompt: '', mode: 'autopilot', ...extra,
  }) + '\n')
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const poll = setInterval(() => {
      if (finals.has(id)) { clearInterval(poll); resolve(finals.get(id)) }
      else if (Date.now() - t0 > 30000) { clearInterval(poll); reject(new Error(`chat ${id} timed out`)) }
    }, 25)
  })
}

try {
  // ═══ Scenario 1: sub-agent end to end ═══
  console.log('\n[1/2] sub-agent loop — spawn → gated write → report → parent final')
  const r1 = await chat(1, 'Delegate writing a report to a sub-agent.')
  // The worker appends a tool log ("🤖 Sub-agent: …") after the model text.
  check('parent received sub-agent report and finished',
    typeof r1.result === 'string' && r1.result.startsWith('PARENT-OK'), JSON.stringify(r1).slice(0, 300))
  check('sub-agent really wrote the file',
    fs.existsSync(path.join(workspace, 'report.txt')) &&
    fs.readFileSync(path.join(workspace, 'report.txt'), 'utf8') === 'hello-from-subagent')
  check('gated write_file round-tripped an approval',
    approvals.some(a => a.tool === 'write_file'), JSON.stringify(approvals).slice(0, 200))
  check('sub-agent tool activity tagged subagent:true',
    activities.some(a => a.subagent === true && a.subagentLabel === 'write the report'))
  const subSys = requests.map(r => r.body?.messages?.[0]).filter(m => m?.role === 'system')
    .some(m => String(m.content).includes('You are a sub-agent'))
  check('sub-agent got its own system prompt', subSys)

  // ═══ Scenario 2: folder skill via use_skill ═══
  console.log('\n[2/2] folder skills — prompt index + use_skill body load')
  const r2 = await chat(2, '/greeting say hello')
  check('use_skill returned the SKILL.md body to the model', r2.result === 'SKILL-OK', JSON.stringify(r2).slice(0, 300))
  const skillReq = requests.find(r => String(r.body?.messages?.find(m => m.role === 'user')?.content || '').startsWith('/greeting'))
  const sysText = String(skillReq?.body?.messages?.[0]?.content || '')
  check('system prompt lists the skill under ## Skills',
    sysText.includes('## Skills') && sysText.includes('greeting') && sysText.includes('Greet the user properly'))
  check('system prompt does NOT include the skill body (selective loading)',
    !sysText.includes('Always answer in haiku form'))

  // ═══ Scenario 3: @-mention expansion + git context injection ═══
  console.log('\n[3/3] @-mentions + git context')
  const r3 = await chat(3, 'Check @notes.txt and @missing.txt and @../escape.txt please')
  check('chat with mentions completed', typeof r3.result === 'string' && r3.result.startsWith('MENTION-DONE'), JSON.stringify(r3).slice(0, 200))
  const mReq = requests.find(r => String(r.body?.messages?.find(m => m.role === 'user')?.content || '').includes('Check @notes.txt'))
  const userMsg = String(mReq?.body?.messages?.find(m => m.role === 'user')?.content || '')
  check('mentioned file contents auto-attached', userMsg.includes('alpha-beta-gamma secret payload') && userMsg.includes('Referenced files'))
  check('missing file left as plain text (no block)', !userMsg.includes('### @missing.txt'))
  check('path-escape mention NOT expanded', !userMsg.includes('### @../escape.txt'))
  const mSys = String(mReq?.body?.messages?.[0]?.content || '')
  check('git context injected (branch + commit)', mSys.includes('## Git status') && mSys.includes('fixture-branch') && mSys.includes('fixture commit'))

  // Screen-control gating (v0.8): no chat in these scenarios mentioned the
  // screen, so screen_* tools must never have been offered to the model.
  const anyScreenTools = requests.some(r =>
    (r.body?.tools || []).some(t => (t?.function?.name || '').startsWith('screen_')))
  check('screen tools withheld without screen intent', !anyScreenTools)
  // Cycle 32: the browser-restraint prompt block is gated on browser intent —
  // none of these scenarios mentioned browsing, so it must be absent.
  const anyBrowserBlock = requests.some(r =>
    String(r.body?.messages?.[0]?.content || '').includes('## Browser tools'))
  check('browser-restraint prompt block absent without intent', !anyBrowserBlock)

  // ═══ Scenario 5: web search tool ═══
  console.log('\n[5/6] web search — DDG parse + result round-trip')
  const r5 = await chat(5, 'Search the web for labaik news please')
  check('model received parsed search results', typeof r5.result === 'string' && r5.result.startsWith('SEARCH-OK'), JSON.stringify(r5).slice(0, 300))

  // ═══ Scenario 6: deep research mode flag ═══
  console.log('\n[6/6] deep research — protocol lands in the system prompt')
  const r6 = await chat(6, 'Plain question with research mode on', { researchMode: true })
  check('research chat completes', typeof r6.result === 'string')
  const rReq = requests.find(r => String(r.body?.messages?.find(m => m.role === 'user')?.content || '').startsWith('Plain question with research mode'))
  const rSys = String(rReq?.body?.messages?.[0]?.content || '')
  check('DEEP RESEARCH protocol in system prompt', rSys.includes('DEEP RESEARCH MODE'))
  check('non-research chats do NOT carry the protocol',
    !String(requests.find(r => String(r.body?.messages?.find(m => m.role === 'user')?.content || '').startsWith('Search the web'))?.body?.messages?.[0]?.content || '').includes('DEEP RESEARCH MODE'))

  // ═══ Scenario 4: stop generation (chat-cancel aborts a hung stream) ═══
  console.log('\n[4/5] stop generation — chat-cancel mid-stream')
  const cancelPromise = chat(4, 'HANG forever please')
  setTimeout(() => {
    worker.stdin.write(JSON.stringify({ type: 'chat-cancel', id: 4 }) + '\n')
  }, 800)
  const r4 = await cancelPromise
  check('cancelled chat resolves (not error/timeout)', typeof r4.result === 'string', JSON.stringify(r4).slice(0, 200))
  check('partial tokens salvaged + Stopped marker',
    String(r4.result || '').includes('partial-before-stop') && String(r4.result || '').includes('⏹ Stopped'),
    JSON.stringify(r4.result).slice(0, 200))
} catch (err) {
  check('fixture ran to completion', false, err.message)
} finally {
  worker.kill()
  server.close()
  fs.rmSync(labaikHome, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
}

console.log('\n' + '━'.repeat(60))
console.log(`  WORKER-LOOP RESULTS: ${pass} passed, ${fail} failed`)
console.log('━'.repeat(60))
process.exit(fail > 0 ? 1 : 0)
