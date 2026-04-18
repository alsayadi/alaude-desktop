const { contextBridge, ipcRenderer, webUtils } = require('electron')

// App version — read at preload time so the renderer can show it without
// round-tripping through IPC. Falls back gracefully if package.json isn't
// resolvable at runtime.
let appVersion = 'dev'
let appHomepage = 'https://github.com/alsayadi/alaude-desktop'
try {
  const pkg = require('../package.json')
  appVersion = pkg.version || 'dev'
  if (pkg.homepage) appHomepage = pkg.homepage
} catch {}

contextBridge.exposeInMainWorld('alaude', {
  version: appVersion,
  homepage: appHomepage,
  releasesUrl: appHomepage.replace(/\/$/, '') + '/releases',
  // Chat
  chat: (messages, model, workspacePath, spaceId, uxMeta) => ipcRenderer.invoke('chat', messages, model, workspacePath, spaceId, uxMeta),
  onToolActivity: (callback) => ipcRenderer.on('tool-activity', (_, activity) => callback(activity)),

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

  // Cron Skills (v0.5.4)
  skillsList: () => ipcRenderer.invoke('skills-list'),
  skillsUpsert: (skill) => ipcRenderer.invoke('skills-upsert', skill),
  skillsRemove: (id) => ipcRenderer.invoke('skills-remove', id),
  skillsSetEnabled: (id, enabled) => ipcRenderer.invoke('skills-set-enabled', id, enabled),
  onSkillRan: (callback) => {
    const h = (_e, payload) => callback(payload)
    ipcRenderer.on('skill-ran', h)
    return () => ipcRenderer.removeListener('skill-ran', h)
  },

  // Permission mode (v0.4.0 — Observe + Autopilot; Careful/Flow arrive later)
  permGetMode: (workspacePath) => ipcRenderer.invoke('perm-get-mode', workspacePath),
  permSetMode: (workspacePath, mode) => ipcRenderer.invoke('perm-set-mode', workspacePath, mode),
  permCycleMode: (workspacePath) => ipcRenderer.invoke('perm-cycle-mode', workspacePath),
  permGetState: () => ipcRenderer.invoke('perm-get-state'),

  // Ollama local runtime
  ollamaAvailable: () => ipcRenderer.invoke('ollama-available'),
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
