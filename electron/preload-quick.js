// Preload for the menu-bar quick window. Exposes a minimal surface: just
// enough to run one-shot chats and show/hide the window.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('alaudeQuick', {
  chat: (messages, model, workspacePath, spaceId, uxMeta) =>
    ipcRenderer.invoke('chat', messages, model, workspacePath, spaceId, uxMeta),
  onToolActivity: (callback) =>
    ipcRenderer.on('tool-activity', (_, activity) => callback(activity)),
  hide: () => ipcRenderer.invoke('quick-hide'),
  openMainWindow: () => ipcRenderer.invoke('quick-open-main'),
  onShow: (callback) => ipcRenderer.on('quick-show', () => callback()),
})
