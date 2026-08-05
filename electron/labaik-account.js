/**
 * labaik-account — signing in to labaik.ai from the desktop app.
 *
 * WHAT THIS IS FOR
 *   Until now Labaik required the user to obtain an API key from a model
 *   provider, which is a wall most people never get over. A Labaik account
 *   is the alternative: sign in with Google in your own browser, get some
 *   free credit, and the app rides on Labaik's key. Bring-your-own-key and
 *   local Ollama both still work exactly as before — this is an additional
 *   door, not a replacement for them.
 *
 * THE HANDSHAKE (device-authorization, RFC 8252 in spirit)
 *   The app never renders a Google login form. It asks labaik.ai for a
 *   short code, opens the system browser, and polls until the server says
 *   a token is ready. The password is typed into the real browser, into
 *   the real Google page, with a real address bar — never into an Electron
 *   window that could read it.
 *
 * WHERE THE TOKEN LIVES
 *   ~/.labaik/account.json, same directory as everything else the app
 *   owns, so "take everything and leave" still means one folder. Signing
 *   out deletes the file and revokes the device server-side, so a stolen
 *   copy of the file stops working rather than merely being forgotten.
 */

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const FILE = path.join(paths.BASE_DIR, 'account.json')
const API_BASE = (process.env.LABAIK_API_BASE || 'https://labaik.ai/api/v1').replace(/\/v1$/, '')
const SITE_BASE = API_BASE.replace(/\/api$/, '')

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 10 * 60 * 1000   // matches the server's code TTL

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null }
}

function write(data) {
  try {
    paths.ensureBaseDir?.()
    fs.mkdirSync(paths.BASE_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
    return true
  } catch { return false }
}

function clear() {
  try { fs.unlinkSync(FILE) } catch {}
}

/** The device token, or null. Read by getCredential() for provider 'labaik'. */
function getToken() {
  return read()?.token || process.env.LABAIK_TOKEN || null
}

const isSignedIn = () => !!getToken()

/**
 * Begin sign-in. Returns { code, verify_url } for the caller to open in
 * the system browser. Deliberately does NOT open it here — main.js owns
 * shell access, and a module that reaches for the browser on its own is
 * hard to test.
 */
async function startSignIn(_fetch = fetch) {
  const res = await _fetch(`${API_BASE}/link/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`sign-in unavailable (${res.status})`)
  return await res.json()
}

/**
 * Poll until the browser half completes. Resolves with the stored account,
 * or throws with a plain-language reason the UI can show as-is.
 */
async function waitForSignIn(code, { _fetch = fetch, onTick, signal } = {}) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Sign-in cancelled.')
    let r
    try {
      const res = await _fetch(`${API_BASE}/link/poll?code=${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(10000),
      })
      r = await res.json()
    } catch {
      r = { status: 'pending' }   // a blip in polling is not a failure
    }
    if (r.status === 'ok' && r.token) {
      const record = {
        token: r.token,
        account: r.account || null,
        signedInAt: Date.now(),
      }
      write(record)
      return record
    }
    if (r.status === 'expired') throw new Error('That sign-in link expired. Please try again.')
    if (r.status === 'already-used') throw new Error('That sign-in link was already used. Please try again.')
    if (r.status === 'unknown') throw new Error('Sign-in link not recognised. Please try again.')
    try { onTick?.(r.status) } catch {}
    await new Promise(res => setTimeout(res, POLL_INTERVAL_MS))
  }
  throw new Error('Sign-in timed out. Please try again.')
}

/** Current balance and plan, straight from the server. Null if signed out. */
async function fetchAccount(_fetch = fetch) {
  const token = getToken()
  if (!token) return null
  try {
    const res = await _fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    })
    if (res.status === 401) { clear(); return null }   // revoked server-side
    if (!res.ok) return read()?.account || null
    const account = await res.json()
    const rec = read() || {}
    write({ ...rec, account, refreshedAt: Date.now() })
    return account
  } catch {
    return read()?.account || null   // offline: last known figures
  }
}

/** Revoke server-side first, then forget locally. */
async function signOut(_fetch = fetch) {
  const token = getToken()
  if (token) {
    try {
      await _fetch(`${API_BASE}/me/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* revoke is best-effort; the local wipe below always happens */ }
  }
  clear()
  return true
}

/** URL of the account page, with the token handed over via the fragment. */
function accountUrl() {
  const token = getToken()
  return token ? `${SITE_BASE}/account#token=${encodeURIComponent(token)}` : `${SITE_BASE}/account`
}

module.exports = {
  FILE, API_BASE, SITE_BASE,
  getToken, isSignedIn, read, write, clear,
  startSignIn, waitForSignIn, fetchAccount, signOut, accountUrl,
}
