/**
 * Custom space persistence — reads/writes ~/.claude/alaude-spaces.json
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const STORE_PATH = path.join(os.homedir(), '.claude', 'alaude-spaces.json')

function readStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    }
  } catch {}
  return { customSpaces: [], activeSpaceId: 'general' }
}

function writeStore(data) {
  try {
    const dir = path.dirname(STORE_PATH)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
    return true
  } catch { return false }
}

function getCustomSpaces() {
  return readStore().customSpaces || []
}

function getActiveSpaceId() {
  return readStore().activeSpaceId || 'general'
}

function setActiveSpaceId(id) {
  const store = readStore()
  store.activeSpaceId = id
  return writeStore(store)
}

function saveCustomSpace(space) {
  const store = readStore()
  const idx = store.customSpaces.findIndex(s => s.id === space.id)
  if (idx >= 0) {
    store.customSpaces[idx] = space
  } else {
    store.customSpaces.push(space)
  }
  return writeStore(store)
}

function deleteCustomSpace(id) {
  const store = readStore()
  store.customSpaces = store.customSpaces.filter(s => s.id !== id)
  if (store.activeSpaceId === id) store.activeSpaceId = 'general'
  return writeStore(store)
}

module.exports = { getCustomSpaces, getActiveSpaceId, setActiveSpaceId, saveCustomSpace, deleteCustomSpace }
