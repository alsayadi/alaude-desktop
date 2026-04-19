/**
 * MCP (Model Context Protocol) client — minimal, dep-free.
 *
 * Users drop a JSON config at ~/.alaude/mcp-servers.json:
 *   { "servers": [
 *     { "name": "fs",      "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "/Users/me/docs"] },
 *     { "name": "github",  "command": "npx", "args": ["@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "ghp_…" } },
 *     { "name": "sqlite",  "command": "mcp-server-sqlite", "args": ["/path/to.db"] }
 *   ] }
 *
 * For each entry we spawn the subprocess, speak JSON-RPC 2.0 over stdio
 * (one message per line, Content-Length header NOT required when using
 * newline-delimited framing — this matches Anthropic's own reference
 * stdio transport), discover its tools, and expose them to the worker as
 * tools with names prefixed `mcp_<server>__<tool>`.
 *
 * Deliberately no SDK dependency — keeps install size down and we don't
 * need the full surface (resources / prompts / completions). Tools only.
 *
 * Runs in the main process because it owns subprocess lifecycle. Worker
 * reaches these tools through the same IPC bridge as browser-agent.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

const CONFIG_FILE = path.join(os.homedir(), '.alaude', 'mcp-servers.json')

// Each server: { name, proc, tools: [...], _msgId, _pending: Map<id, resolve/reject>, _buf }
const _servers = new Map()

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { servers: [] }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.servers)) parsed.servers = []
    return parsed
  } catch (err) {
    console.warn('[mcp] config load failed:', err.message)
    return { servers: [] }
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {
    console.warn('[mcp] config save failed:', err.message)
  }
}

// ── JSON-RPC helper ────────────────────────────────────────────────────────
function _send(server, method, params) {
  const id = ++server._msgId
  const msg = { jsonrpc: '2.0', id, method, params: params || {} }
  return new Promise((resolve, reject) => {
    server._pending.set(id, { resolve, reject })
    try { server.proc.stdin.write(JSON.stringify(msg) + '\n') } catch (err) { reject(err); server._pending.delete(id) }
    // 30s per-call deadline — prevents a hung server from wedging the chat.
    setTimeout(() => {
      if (server._pending.has(id)) {
        server._pending.delete(id)
        reject(new Error(`MCP ${server.name} method ${method} timed out`))
      }
    }, 30000)
  })
}

function _onServerLine(server, line) {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.id == null) return // notification, ignore
  const pending = server._pending.get(msg.id)
  if (!pending) return
  server._pending.delete(msg.id)
  if (msg.error) pending.reject(new Error(`MCP ${server.name}: ${msg.error.message || 'error'}`))
  else pending.resolve(msg.result)
}

async function startServer(cfg) {
  if (_servers.has(cfg.name)) {
    // already running
    return _servers.get(cfg.name)
  }
  if (!cfg.command) throw new Error('server.command required')
  const env = { ...process.env, ...(cfg.env || {}) }
  const proc = spawn(cfg.command, cfg.args || [], { stdio: ['pipe', 'pipe', 'pipe'], env })
  const server = { name: cfg.name, proc, tools: [], _msgId: 0, _pending: new Map(), _buf: '', status: 'starting' }
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    server._buf += chunk
    let idx
    while ((idx = server._buf.indexOf('\n')) !== -1) {
      const line = server._buf.slice(0, idx)
      server._buf = server._buf.slice(idx + 1)
      _onServerLine(server, line)
    }
  })
  proc.stderr.on('data', (d) => { try { process.stderr.write(`[mcp:${cfg.name}] ${d}`) } catch {} })
  proc.on('error', (err) => {
    console.error(`[mcp:${cfg.name}] spawn error:`, err.message)
    server.status = 'error'
    server.error = err.message
  })
  proc.on('exit', (code) => {
    server.status = 'stopped'
    server.exitCode = code
    // Reject any in-flight
    for (const [id, p] of server._pending) p.reject(new Error(`MCP ${cfg.name} exited (${code})`))
    server._pending.clear()
    _servers.delete(cfg.name)
  })
  _servers.set(cfg.name, server)
  // Handshake + tool discovery
  try {
    await _send(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'Labaik', version: require('../package.json').version },
    })
    const list = await _send(server, 'tools/list', {})
    server.tools = (list?.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }))
    server.status = 'ready'
  } catch (err) {
    server.status = 'error'
    server.error = err.message
    console.error(`[mcp:${cfg.name}] init failed:`, err.message)
  }
  return server
}

async function startAll() {
  const cfg = loadConfig()
  const results = []
  for (const s of cfg.servers) {
    if (s.disabled) { results.push({ name: s.name, status: 'disabled' }); continue }
    try {
      const srv = await startServer(s)
      results.push({ name: s.name, status: srv.status, toolCount: srv.tools.length, error: srv.error })
    } catch (err) {
      results.push({ name: s.name, status: 'error', error: err.message })
    }
  }
  return results
}

function stopAll() {
  for (const s of _servers.values()) {
    try { s.proc.kill() } catch {}
  }
  _servers.clear()
}

// Return all tool schemas in OpenAI function-calling shape. Names are
// namespaced as mcp_<server>__<tool> so they can't collide with built-in
// tools or with other MCP servers.
function getToolSchemas() {
  const out = []
  for (const s of _servers.values()) {
    if (s.status !== 'ready') continue
    for (const t of s.tools) {
      out.push({
        type: 'function',
        function: {
          name: `mcp_${s.name}__${t.name}`,
          description: t.description,
          parameters: t.inputSchema,
        },
      })
    }
  }
  return out
}

// Execute a tool call. Name is `mcp_<server>__<tool>`. Returns either the
// tool's content array (MCP standard) or an { error } object.
async function callTool(fullName, args) {
  const m = /^mcp_([^_][^_]*(?:_[^_]+)*)__([^_].+)$/.exec(fullName) || /^mcp_([^_]+)__(.+)$/.exec(fullName)
  if (!m) return { error: `invalid MCP tool name: ${fullName}` }
  const [, serverName, toolName] = m
  const server = _servers.get(serverName)
  if (!server) return { error: `MCP server not running: ${serverName}` }
  if (server.status !== 'ready') return { error: `MCP server ${serverName} not ready: ${server.status} ${server.error || ''}` }
  try {
    const result = await _send(server, 'tools/call', { name: toolName, arguments: args || {} })
    // MCP returns { content: [{type:'text',text:...} | {type:'image',...}], isError? }
    if (result?.isError) return { error: JSON.stringify(result.content).slice(0, 1000) }
    const texts = (result?.content || []).filter(c => c.type === 'text').map(c => c.text)
    return { content: texts.join('\n').slice(0, 50000), raw: result }
  } catch (err) {
    return { error: String(err?.message || err) }
  }
}

// Admin helpers — used by the IPC layer so the renderer can manage servers.
function listStatus() {
  const arr = []
  for (const s of _servers.values()) {
    arr.push({ name: s.name, status: s.status, toolCount: s.tools.length, error: s.error || null,
               tools: s.tools.map(t => ({ name: t.name, description: t.description })) })
  }
  return arr
}

async function addServer(cfg) {
  const state = loadConfig()
  state.servers = state.servers.filter(s => s.name !== cfg.name)
  state.servers.push(cfg)
  saveConfig(state)
  return await startServer(cfg)
}

async function removeServer(name) {
  const state = loadConfig()
  state.servers = state.servers.filter(s => s.name !== name)
  saveConfig(state)
  const s = _servers.get(name)
  if (s) { try { s.proc.kill() } catch {}; _servers.delete(name) }
  return true
}

module.exports = {
  loadConfig, saveConfig,
  startAll, stopAll,
  startServer, addServer, removeServer,
  getToolSchemas, callTool, listStatus,
}
