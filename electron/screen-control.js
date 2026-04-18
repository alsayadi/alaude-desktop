/**
 * Screen control — give the model physical access to the user's desktop.
 *
 * Paired with Screen Vision (v0.5.2), this closes the loop: model sees a
 * screenshot, reasons about what to do, then clicks / types / hits keys
 * on the actual screen. Unlike the Browser Agent which only drives an
 * Electron-owned Chromium window, these tools touch the whole OS —
 * Slack, Xcode, anything.
 *
 * Implementation (macOS): prefer `cliclick` if installed; fall back to
 * AppleScript via `osascript`. Neither is shipped with Alaude — cliclick
 * is a one-line Homebrew install, AppleScript is always available.
 *
 * Security: these tools respect Observe mode in api-worker.js; they're
 * classified as write-ish operations. When Careful / Flow approval
 * prompts land they'll gate here too.
 */

const { exec } = require('child_process')
const { promisify } = require('util')
const execP = promisify(exec)
const fs = require('fs')

// Cache which backend we have available on first use.
let _backend = null  // 'cliclick' | 'applescript' | null
async function _detect() {
  if (_backend) return _backend
  try {
    // Look for cliclick in common Homebrew paths
    for (const p of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
      if (fs.existsSync(p)) { _backend = p; return _backend }
    }
    // which as a last resort
    const { stdout } = await execP('/usr/bin/which cliclick')
    const path = stdout.trim()
    if (path) { _backend = path; return _backend }
  } catch {}
  // No cliclick — AppleScript always available on macOS
  _backend = 'applescript'
  return _backend
}

function _escShellArg(s) {
  // Safe single-quote escaping for shell args
  return `'${String(s ?? '').replace(/'/g, `'\\''`)}'`
}

async function click({ x, y, button = 'left' }) {
  const b = await _detect()
  const xi = Math.round(Number(x)); const yi = Math.round(Number(y))
  if (!Number.isFinite(xi) || !Number.isFinite(yi)) throw new Error('click requires numeric x, y')
  if (b !== 'applescript') {
    const cmd = button === 'right' ? `rc:${xi},${yi}` : `c:${xi},${yi}`
    await execP(`${_escShellArg(b)} ${cmd}`)
  } else {
    // AppleScript needs cliclick-or-CG-Events — use a CG events shim via
    // osascript + tell System Events. System Events doesn't expose a click
    // at absolute coordinates natively, so this path is best-effort only.
    // Strongly encourage cliclick for reliability.
    const script = `tell application "System Events" to click at {${xi}, ${yi}}`
    await execP(`/usr/bin/osascript -e ${_escShellArg(script)}`)
  }
  return { ok: true, x: xi, y: yi, button }
}

async function type({ text }) {
  const b = await _detect()
  const s = String(text ?? '')
  if (!s) return { ok: true, typed: 0 }
  if (b !== 'applescript') {
    // cliclick t:<text> — but long strings and special chars need care.
    // Split into chunks of 200 chars to avoid arg-length issues.
    for (let i = 0; i < s.length; i += 200) {
      const chunk = s.slice(i, i + 200)
      await execP(`${_escShellArg(b)} t:${_escShellArg(chunk)}`)
    }
  } else {
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const script = `tell application "System Events" to keystroke "${escaped}"`
    await execP(`/usr/bin/osascript -e ${_escShellArg(script)}`)
  }
  return { ok: true, typed: s.length, via: b }
}

// Key combo helper — accepts strings like 'cmd+c', 'cmd+shift+t', 'return',
// 'escape'. Maps to cliclick kp:<key> for single keys or a kd/ku chain
// for modifiers.
async function key({ combo }) {
  const b = await _detect()
  const parts = String(combo || '').toLowerCase().split('+').map(s => s.trim()).filter(Boolean)
  if (!parts.length) throw new Error('key requires a combo, e.g. "cmd+c" or "escape"')
  const mods = parts.slice(0, -1)
  const final = parts[parts.length - 1]
  // cliclick supported single keys: https://github.com/BlueM/cliclick
  const cliClickKeyMap = {
    return: 'return', enter: 'return', tab: 'tab', escape: 'esc', esc: 'esc',
    space: 'space', backspace: 'delete', delete: 'delete',
    up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right',
  }
  if (b !== 'applescript') {
    if (mods.length === 0) {
      // Single key — either a named key or a printable char
      if (cliClickKeyMap[final]) {
        await execP(`${_escShellArg(b)} kp:${cliClickKeyMap[final]}`)
      } else if (final.length === 1) {
        await execP(`${_escShellArg(b)} t:${_escShellArg(final)}`)
      } else {
        throw new Error(`unknown key: ${final}`)
      }
    } else {
      // Modifiers held, then key pressed, then release
      const modMap = { cmd: 'cmd', command: 'cmd', meta: 'cmd', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', opt: 'alt', option: 'alt', shift: 'shift' }
      const cliMods = mods.map(m => modMap[m]).filter(Boolean)
      if (cliMods.length !== mods.length) throw new Error(`unknown modifier in ${combo}`)
      const kd = cliMods.map(m => `kd:${m}`).join(' ')
      const ku = cliMods.map(m => `ku:${m}`).join(' ')
      const keyPress = cliClickKeyMap[final]
        ? `kp:${cliClickKeyMap[final]}`
        : (final.length === 1 ? `t:${_escShellArg(final)}` : null)
      if (!keyPress) throw new Error(`unknown key: ${final}`)
      await execP(`${_escShellArg(b)} ${kd} ${keyPress} ${ku}`)
    }
  } else {
    // AppleScript keystroke path
    const appleMap = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', opt: 'option down', option: 'option down', shift: 'shift down' }
    const appleMods = mods.map(m => appleMap[m]).filter(Boolean).join(', ')
    const keyCodeMap = { return: '36', enter: '36', tab: '48', escape: '53', esc: '53', space: '49', delete: '51', backspace: '51', up: '126', down: '125', left: '123', right: '124' }
    let script
    if (keyCodeMap[final]) {
      script = appleMods
        ? `tell application "System Events" to key code ${keyCodeMap[final]} using {${appleMods}}`
        : `tell application "System Events" to key code ${keyCodeMap[final]}`
    } else if (final.length === 1) {
      script = appleMods
        ? `tell application "System Events" to keystroke "${final}" using {${appleMods}}`
        : `tell application "System Events" to keystroke "${final}"`
    } else {
      throw new Error(`unknown key: ${final}`)
    }
    await execP(`/usr/bin/osascript -e ${_escShellArg(script)}`)
  }
  return { ok: true, combo }
}

async function moveMouse({ x, y }) {
  const b = await _detect()
  const xi = Math.round(Number(x)); const yi = Math.round(Number(y))
  if (!Number.isFinite(xi) || !Number.isFinite(yi)) throw new Error('moveMouse requires numeric x, y')
  if (b !== 'applescript') {
    await execP(`${_escShellArg(b)} m:${xi},${yi}`)
  } else {
    throw new Error('moveMouse requires cliclick — install via `brew install cliclick`')
  }
  return { ok: true, x: xi, y: yi }
}

async function backend() {
  return await _detect()
}

// OpenAI-style tool schemas
const TOOLS = [
  { type: 'function', function: { name: 'screen_click', description: 'Click a screen coordinate (x, y in pixels from top-left of main display). Use after a screenshot to operate the active app. Requires cliclick (brew install cliclick) for reliability.', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button, default left' } }, required: ['x', 'y'] } } },
  { type: 'function', function: { name: 'screen_type', description: 'Type text into whatever has keyboard focus on the screen. Works for any app — Slack, Xcode, etc.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'screen_key', description: 'Send a keyboard combo (e.g. "cmd+c", "cmd+shift+t", "escape", "return"). Used for shortcuts and modal dismissal.', parameters: { type: 'object', properties: { combo: { type: 'string', description: 'e.g. "cmd+c", "escape", "return"' } }, required: ['combo'] } } },
  { type: 'function', function: { name: 'screen_move_mouse', description: 'Move the mouse cursor to a screen coordinate without clicking. Useful for hover-triggered tooltips.', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
]

module.exports = { click, type, key, moveMouse, backend, TOOLS }
