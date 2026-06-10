const { contextBridge, ipcRenderer, webUtils } = require('electron')

// App version — passed via additionalArguments from main.js (sandboxed
// preloads can't require('../package.json')). Previous require-based fallback
// silently returned 'dev' which led to "vdev" in the topbar.
let appVersion = 'dev'
let appHomepage = 'https://github.com/alsayadi/alaude-desktop'
for (const arg of process.argv) {
  if (arg.startsWith('--alaude-version=')) appVersion = arg.slice('--alaude-version='.length) || 'dev'
  else if (arg.startsWith('--alaude-homepage=') && arg.length > '--alaude-homepage='.length) {
    appHomepage = arg.slice('--alaude-homepage='.length)
  }
}
// Secondary fallback: if argv didn't carry it (e.g. quick-window), try the
// require path — harmless when sandboxed (returns 'dev' anyway).
if (appVersion === 'dev') {
  try {
    const pkg = require('../package.json')
    if (pkg.version) appVersion = pkg.version
    if (pkg.homepage) appHomepage = pkg.homepage
  } catch {}
}

contextBridge.exposeInMainWorld('alaude', {
  version: appVersion,
  homepage: appHomepage,
  releasesUrl: appHomepage.replace(/\/$/, '') + '/releases',
  openFutureConsole: () => ipcRenderer.invoke('open-future-console'),
  // Chat
  chat: (messages, model, workspacePath, spaceId, uxMeta) => ipcRenderer.invoke('chat', messages, model, workspacePath, spaceId, uxMeta),
  onToolActivity: (callback) => ipcRenderer.on('tool-activity', (_, activity) => callback(activity)),
  // v0.8 — Stop generation: aborts every in-flight chat; each resolves with
  // its partial text plus a "⏹ Stopped." marker.
  chatCancelAll: () => ipcRenderer.invoke('chat-cancel-all'),
  // v0.8 — paste-any-key: detect which provider a key belongs to.
  loginDetectKey: (key) => ipcRenderer.invoke('login-detect-key', key),
  // v0.8 — import conversations.json from a ChatGPT data export.
  importChatGPT: () => ipcRenderer.invoke('import-chatgpt'),

  // UX OODA loop (local-only dev instrumentation)
  logUxEvent: (event) => ipcRenderer.invoke('ux-event', event),
  getUxInsights: () => ipcRenderer.invoke('ux-insights'),
  runUxBatch: () => ipcRenderer.invoke('ux-run-batch'),

  // Key management
  getKeyStatuses: () => ipcRenderer.invoke('get-key-statuses'),
  setKey: (provider, key) => ipcRenderer.invoke('set-key', provider, key),

  // OAuth login
  oauthLogin: (provider) => ipcRenderer.invoke('oauth-login', provider),
  onLoginSuccess: (callback) => ipcRenderer.on('login-success', (_, provider) => callback(provider)),

  // Folder picker
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  listFiles: (path) => ipcRenderer.invoke('list-files', path),
  workspaceList: (path) => ipcRenderer.invoke('workspace-list', path),
  // v0.4.4 — recursive file index for @-mention autocomplete.
  workspaceFiles: (path) => ipcRenderer.invoke('workspace-files', path),

  // v0.7.31 Task Scope — create a subfolder inside the picked workspace for
  // the current session, keeping generated files out of the workspace root.
  // Returns { ok, path?, existed?, reason? }.
  taskScopeCreateFolder: (parent, name) => ipcRenderer.invoke('task-scope-create-folder', parent, name),
  // v0.7.32 — heuristic project detector. True = existing project (auto-scope off).
  taskScopeLooksLikeProject: (folderPath) => ipcRenderer.invoke('task-scope-looks-like-project', folderPath),

  // v0.7.40 — dev server lifecycle.
  // killTrackedServers()  → { killed, pids } — kill every server Labaik started this process
  // listTrackedServers()  → array of { pid, port, startedAt, workspacePath }
  // portInUse(port)       → { occupied, pid? } — quick check via lsof
  killTrackedServers: () => ipcRenderer.invoke('kill-tracked-servers'),
  listTrackedServers: () => ipcRenderer.invoke('list-tracked-servers'),
  portInUse: (port) => ipcRenderer.invoke('port-in-use', port),

  // File handling
  // Electron 32+ removed File.path with contextIsolation on — webUtils is the
  // replacement for recovering the real on-disk path of a dropped/picked File.
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  readFileForChat: (filePath) => ipcRenderer.invoke('read-file-for-chat', filePath),
  // v0.6.0 Screen Vision: takes a screenshot and returns the file path.
  // mode: 'region' (default, interactive crosshair) | 'window' | 'screen'.
  captureScreen: (mode) => ipcRenderer.invoke('capture-screen', mode),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  saveFile: (content, defaultName) => ipcRenderer.invoke('save-file', content, defaultName),
  saveBinaryFile: (arrayBuffer, defaultName) => ipcRenderer.invoke('save-binary-file', arrayBuffer, defaultName),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // Open URL in system browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Spaces
  getSpaces: () => ipcRenderer.invoke('get-spaces'),
  setActiveSpace: (id) => ipcRenderer.invoke('set-active-space', id),
  saveCustomSpace: (space) => ipcRenderer.invoke('save-custom-space', space),
  deleteCustomSpace: (id) => ipcRenderer.invoke('delete-custom-space', id),

  // Session events from menu
  onNewSession: (callback) => ipcRenderer.on('new-session', () => callback()),

  // MCP — Model Context Protocol (v0.5.6)
  mcpStatus: () => ipcRenderer.invoke('mcp-status'),
  mcpAddServer: (cfg) => ipcRenderer.invoke('mcp-add-server', cfg),
  mcpRemoveServer: (name) => ipcRenderer.invoke('mcp-remove-server', name),
  mcpGetConfig: () => ipcRenderer.invoke('mcp-get-config'),
  onMcpReady: (callback) => {
    const h = (_e, payload) => callback(payload)
    ipcRenderer.on('mcp-ready', h)
    return () => ipcRenderer.removeListener('mcp-ready', h)
  },

  // Durable JSON store (v0.7.59) — localStorage-compatible semantics but
  // writes go to ~/.labaik/{name}.json with atomic tmp+rename in the main
  // process, so they survive SIGTERM/crash windows that lose batched
  // LevelDB writes. Used by memory + profile stores. Sync on purpose:
  // small files, fast, and matches the existing call-site assumptions.
  fsJsonReadSync: (name) => {
    try { return ipcRenderer.sendSync('fs-json-read-sync', name) } catch { return null }
  },
  fsJsonWriteSync: (name, data) => {
    try { return ipcRenderer.sendSync('fs-json-write-sync', name, data) } catch { return false }
  },

  // Routines (v0.5.4 — was "Cron Skills"; fully renamed in v0.8)
  routinesList: () => ipcRenderer.invoke('routines-list'),
  routinesUpsert: (routine) => ipcRenderer.invoke('routines-upsert', routine),
  routinesRemove: (id) => ipcRenderer.invoke('routines-remove', id),
  routinesSetEnabled: (id, enabled) => ipcRenderer.invoke('routines-set-enabled', id, enabled),
  onRoutineRan: (callback) => {
    const h = (_e, payload) => callback(payload)
    ipcRenderer.on('routine-ran', h)
    return () => ipcRenderer.removeListener('routine-ran', h)
  },

  // Folder-skills (v0.7.67) — filesystem-discovered prompt templates from
  // ~/.labaik/skills/<slug>/SKILL.md. Surfaced in the command palette.
  folderSkillsList: () => ipcRenderer.invoke('folder-skills-list'),
  folderSkillsGet: (slug) => ipcRenderer.invoke('folder-skills-get', slug),
  folderSkillsInstallStarters: () => ipcRenderer.invoke('folder-skills-install-starters'),

  // Permission mode (v0.4.0; Careful/Flow approval dialog added v0.4.1)
  permGetMode: (workspacePath) => ipcRenderer.invoke('perm-get-mode', workspacePath),
  permSetMode: (workspacePath, mode) => ipcRenderer.invoke('perm-set-mode', workspacePath, mode),
  permCycleMode: (workspacePath) => ipcRenderer.invoke('perm-cycle-mode', workspacePath),
  permGetState: () => ipcRenderer.invoke('perm-get-state'),

  // Approval flow (v0.4.1) — main asks the user before a side-effecting tool
  // runs when the mode (Careful/Flow) or a protected path/dangerous command
  // requires it. onPermissionRequest fires with the request; permRespond
  // sends back 'allow-once' | 'allow-always' | 'deny'.
  onPermissionRequest: (callback) => {
    const h = (_e, payload) => callback(payload)
    ipcRenderer.on('permission-request', h)
    return () => ipcRenderer.removeListener('permission-request', h)
  },
  permRespond: (approvalId, decision) => ipcRenderer.invoke('perm-respond', approvalId, decision),

  // Ollama local runtime
  ollamaAvailable: () => ipcRenderer.invoke('ollama-available'),
  // v0.6.0 Semantic memory — local embeddings via Ollama /api/embed.
  // Returns { ok, model, embeddings: number[][] } or { ok:false, reason }.
  ollamaEmbed: (texts, model) => ipcRenderer.invoke('ollama-embed', texts, model),
  ollamaFindEmbedModel: () => ipcRenderer.invoke('ollama-find-embed-model'),
  // v0.5.0: in-app installer — no browser trip to ollama.com
  ollamaInstall: () => ipcRenderer.invoke('ollama-install'),
  onOllamaInstallProgress: (callback) => {
    const handler = (_e, data) => callback(data)
    ipcRenderer.on('ollama-install-progress', handler)
    return () => ipcRenderer.removeListener('ollama-install-progress', handler)
  },
  ollamaList: () => ipcRenderer.invoke('ollama-list'),
  ollamaCatalog: () => ipcRenderer.invoke('ollama-catalog'),
  ollamaPull: (model) => ipcRenderer.invoke('ollama-pull', model),
  ollamaCancel: (model) => ipcRenderer.invoke('ollama-cancel', model),
  ollamaRemove: (model) => ipcRenderer.invoke('ollama-remove', model),
  onModelDownloadProgress: (callback) => ipcRenderer.on('model-download-progress', (_e, data) => callback(data)),
})
