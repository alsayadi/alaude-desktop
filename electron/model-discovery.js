/**
 * model-discovery — ask each provider what models the user's key can see.
 *
 * WHY: the picker in renderer/index.html is a CURATED list — human labels,
 * tier ordering, published prices. That curation is worth keeping, but it
 * only travels with an app release, so a model that launched this morning
 * is unreachable until the next build ships. Worse, there is no "type a
 * custom model id" escape hatch for cloud providers (local Ollama has one),
 * so the hardcoded list is a hard block, not an inconvenience.
 *
 * This module closes that gap WITHOUT a backend: every provider already
 * exposes a models endpoint, and the user already has a key for it. We ask
 * the provider directly, on the user's own credentials, and surface
 * anything the curated list doesn't already know about.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - No price discovery. No provider exposes pricing programmatically.
 *     Unknown models render with an honest "price unknown" badge rather
 *     than a guess — a wrong number is worse than an absent one in a
 *     feature whose whole point is truthful receipts.
 *   - No phone-home. Nothing is fetched from labaik.ai; there is no
 *     manifest and no server to depend on. If this file's network calls
 *     all fail, the app behaves exactly as it did before it existed.
 *
 * PRIVACY: one GET per provider the user ALREADY has a key for, cached for
 * 24h on disk. No key → no call. Every call is written to the net-ledger
 * by the caller in main.js, so it shows up in "Your data" like any other.
 */

const fs = require('fs')
const path = require('path')
const { BASE_DIR, ensureBaseDir } = require('./paths')
const { getBaseURL } = require('./provider-registry')

const CACHE_FILE = path.join(BASE_DIR, 'model-discovery.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
/** Hard cap per provider — a runaway list must never flood the picker. */
const MAX_PER_PROVIDER = 40

/**
 * Model ids that are real but are NOT chat models. `/v1/models` returns
 * the provider's entire catalogue: embeddings, speech, image, moderation,
 * rerank. OpenAI alone answers with ~80 entries. Dropping these is the
 * difference between a useful extra group and an unusable wall of noise.
 */
const NON_CHAT_RE = new RegExp([
  'embed', 'embedding',
  'whisper', 'tts', 'audio-speech', 'transcribe', 'realtime',
  'dall-e', 'image', 'stable-diffusion', 'flux', 'video', 'veo', 'imagen',
  'moderation', 'guard', 'rerank', 'search-', 'similarity',
  'davinci', 'babbage', 'curie', 'ada',
  'codex-', 'instruct-beta',
].join('|'), 'i')

/**
 * Providers whose models endpoint is NOT the OpenAI-compatible
 * `GET {base}/models` with a Bearer token. Anthropic and Google are the
 * two that differ; everything else in provider-registry speaks the
 * OpenAI shape, which is exactly why the registry's baseURL works here.
 */
const SPECIAL = {
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/models?limit=100',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    extract: (json) => (json?.data || []).map(m => m?.id),
  },
  google: {
    // Google puts the key in the query string and namespaces ids as
    // "models/gemini-…" — strip the prefix so ids match what the picker
    // and the router use.
    url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    headers: () => ({}),
    extract: (json) => (json?.models || [])
      .filter(m => !Array.isArray(m?.supportedGenerationMethods) ||
                    m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m?.name || '').replace(/^models\//, '')),
  },
}

/** True when an id looks like a chat model worth offering. */
function isChatModel(id) {
  if (!id || typeof id !== 'string') return false
  if (id.length > 80) return false
  return !NON_CHAT_RE.test(id)
}

/**
 * Ask ONE provider what it has. Never throws — a dead endpoint, a bad key
 * or no network resolves to an empty list, because discovery is strictly
 * additive polish on top of the bundled catalog.
 *
 * `_fetch` is injectable so tests never touch the network.
 */
async function discoverProvider(provider, key, _fetch) {
  const doFetch = _fetch || fetch
  if (!provider || !key) return { provider, models: [], error: 'no-key' }

  const special = SPECIAL[provider]
  let url, headers
  if (special) {
    url = special.url(key)
    headers = special.headers(key)
  } else {
    const base = getBaseURL(provider)
    // Providers routed by SDK default (no baseURL) and not special-cased
    // have no endpoint we can guess — skip rather than invent one.
    if (!base) return { provider, models: [], error: 'no-endpoint' }
    url = base.replace(/\/$/, '') + '/models'
    headers = { Authorization: `Bearer ${key}` }
  }

  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return { provider, models: [], error: 'http-' + res.status }
    const json = await res.json()
    const raw = special ? special.extract(json) : (json?.data || []).map(m => m?.id)
    const models = [...new Set(raw.filter(isChatModel))].slice(0, MAX_PER_PROVIDER)
    return { provider, models }
  } catch (err) {
    const name = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network'
    return { provider, models: [], error: name }
  }
}

// ── cache ────────────────────────────────────────────────────────────────
// Keyed by provider so a newly-added key discovers immediately instead of
// waiting out a whole-file TTL set by some other provider.

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {} } catch { return {} }
}

function writeCache(cache) {
  try {
    ensureBaseDir()
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
  } catch {}
}

function isFresh(entry, now) {
  return !!entry && typeof entry.ts === 'number' && (now - entry.ts) < CACHE_TTL_MS
}

/**
 * Discover across several providers, using the 24h cache where possible.
 *
 * @param {string[]} providers  provider ids the user actually has keys for
 * @param {(p:string)=>string} getKey
 * @param {object} opts  { force, _fetch, _now, onCall }
 *        onCall(provider, url-ish) fires for each REAL network request so
 *        main.js can write it to the net-ledger.
 * @returns {Promise<{models: Record<string,string[]>, fetched: string[], cached: string[]}>}
 */
async function discoverAll(providers, getKey, opts = {}) {
  const { force = false, _fetch, _now, onCall } = opts
  const now = typeof _now === 'number' ? _now : Date.now()
  const cache = readCache()
  const out = { models: {}, fetched: [], cached: [], errors: {} }

  const jobs = []
  for (const provider of providers || []) {
    const key = (() => { try { return getKey(provider) } catch { return null } })()
    if (!key) continue
    if (!force && isFresh(cache[provider], now)) {
      out.models[provider] = cache[provider].models || []
      out.cached.push(provider)
      continue
    }
    jobs.push((async () => {
      try { onCall?.(provider) } catch {}
      const r = await discoverProvider(provider, key, _fetch)
      if (r.error) {
        out.errors[provider] = r.error
        // Keep serving a stale list rather than losing models on a blip.
        if (cache[provider]?.models?.length) {
          out.models[provider] = cache[provider].models
          return
        }
      }
      out.models[provider] = r.models
      out.fetched.push(provider)
      // Only a successful call refreshes the timestamp; a failure must not
      // start a fresh 24h of silence.
      if (!r.error) cache[provider] = { ts: now, models: r.models }
    })())
  }

  await Promise.all(jobs)
  writeCache(cache)
  return out
}

module.exports = {
  discoverAll,
  discoverProvider,
  isChatModel,
  CACHE_FILE,
  CACHE_TTL_MS,
  MAX_PER_PROVIDER,
}
