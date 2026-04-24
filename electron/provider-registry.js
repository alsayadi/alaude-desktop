/**
 * provider-registry — single source of truth for LLM provider routing.
 *
 * Why this file exists:
 *   `detectProvider` and `getBaseURL` used to be copy-pasted between
 *   `api-worker.js` and `main.js`. Every new provider meant editing two
 *   files; any drift between them caused subtle routing bugs (main's
 *   `get-key-statuses` would report a key for a provider that worker
 *   couldn't actually route to, or vice versa). This module is the
 *   canonical list. Both callers `require` it.
 *
 * Shape of a row:
 *   baseURL     — OpenAI-compatible v1 endpoint. `undefined` means the
 *                 SDK's own default is used (Anthropic, OpenAI, Google).
 *   prefixes    — lowercase prefix matches against the incoming model
 *                 id. Order within a row doesn't matter. Order ACROSS
 *                 rows matters — Ollama is checked first (special cases
 *                 below), then the registry iteration order decides
 *                 ties (see the `kimi` vs `moonshot` note).
 *   stripPrefix — if present, `normalizeModelId()` strips this prefix
 *                 before the model id reaches the SDK. Used for routing
 *                 hints that aren't real model ids at the upstream
 *                 endpoint (e.g. `ollama/` or `kimi-intl/`).
 *   envVar      — optional env var fallback for the API key, read by
 *                 `api-worker.js:getCredential()` when no stored key
 *                 exists.
 *
 * IMPORTANT — case sensitivity:
 *   Matching is done on a lowercased copy of the model id. The ORIGINAL
 *   string is what reaches the SDK. Some providers (MiniMax) are
 *   case-sensitive on model ids (`MiniMax-M2.7` ≠ `minimax-m2.7`), so
 *   this module must never return the lowercased value as the model
 *   string. `normalizeModelId` preserves case in its return value.
 */

// Ordered: kimi (global) before moonshot (CN) so `kimi-intl/` hits kimi.
// An array-of-pairs keeps that order explicit even though modern
// JavaScript object iteration is insertion-ordered in practice.
const PROVIDERS_ORDERED = [
  // Routed by SDK default URL (no baseURL needed)
  ['anthropic', { baseURL: undefined, prefixes: [], envVar: 'ANTHROPIC_API_KEY' }],
  ['openai',    { baseURL: undefined, prefixes: ['gpt-', 'o1', 'o3', 'o4'], envVar: 'OPENAI_API_KEY' }],
  ['google',    { baseURL: undefined, prefixes: ['gemini'], envVar: 'GEMINI_API_KEY' }],

  // xAI — OpenAI-compatible
  ['xai',       { baseURL: 'https://api.x.ai/v1', prefixes: ['grok-'], envVar: 'XAI_API_KEY' }],

  // Kimi GLOBAL — MUST come before `moonshot` in iteration order so
  // `kimi-intl/kimi-k2.6` doesn't fall through to the CN endpoint.
  // Users who signed up at kimi.ai have keys that work against
  // api.moonshot.ai but NOT api.moonshot.cn and vice versa.
  ['kimi',      { baseURL: 'https://api.moonshot.ai/v1', prefixes: ['kimi-intl/'], stripPrefix: 'kimi-intl/', envVar: 'KIMI_API_KEY' }],

  // Kimi CN (kimi.com) — the original moonshot endpoint. Plain `kimi-*`
  // and `moonshot-v1-*` continue to route here for backward compat with
  // saved sessions from before the kimi.ai endpoint existed.
  ['moonshot',  { baseURL: 'https://api.moonshot.cn/v1', prefixes: ['moonshot-', 'kimi-'], envVar: 'MOONSHOT_API_KEY' }],

  // Alibaba Qwen via DashScope's OpenAI-compatible endpoint. Prefix is
  // just `qwen` (no dash) to catch both legacy `qwen-max` and the newer
  // `qwen3.6-max-preview` (which uses dots) without a collision — no
  // other provider ships a model id starting with `qwen`.
  ['dashscope', { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', prefixes: ['qwen'], envVar: 'DASHSCOPE_API_KEY' }],

  // Zhipu GLM — GLM-5 / GLM-5.1 / GLM-4.x all match.
  ['zhipu',     { baseURL: 'https://open.bigmodel.cn/api/paas/v4', prefixes: ['glm-'], envVar: 'ZHIPU_API_KEY' }],

  // MiniMax — case-insensitive prefix `minimax-` catches MiniMax-M2.7
  // after lowercasing for the match; the original-case model string
  // reaches the SDK unchanged (their API 400s on lowercased ids).
  ['minimax',   { baseURL: 'https://api.minimax.io/v1', prefixes: ['minimax-'], envVar: 'MINIMAX_API_KEY' }],

  // Tencent Hunyuan — match both `hunyuan-` (older families like
  // hunyuan-turbo / hunyuan-t1) and `hy3-` / `hy4-` (the new Hy-series
  // flagships). Absorbed in the router so users never have to type a
  // synthetic `hunyuan/` prefix in the picker.
  ['hunyuan',   { baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', prefixes: ['hunyuan-', 'hy3-', 'hy4-'], envVar: 'HUNYUAN_API_KEY' }],

  // DeepSeek (v0.7.65) — OpenAI-compatible, sk-... keys from
  // platform.deepseek.com. The `deepseek-` prefix COULD collide with the
  // local Ollama `deepseek-r1` family, but the Ollama branch at the top
  // of detectProvider() checks `includes(':')` and `startsWith('deepseek-r1')`
  // first, so cloud `deepseek-v4`/`-chat`/`-reasoner` route here while
  // local `deepseek-r1:7b` still routes to 'ollama'.
  ['deepseek',  { baseURL: 'https://api.deepseek.com/v1', prefixes: ['deepseek-'], envVar: 'DEEPSEEK_API_KEY' }],

  // Ollama — local. Treated specially in detectProvider() because
  // Ollama tags use `name:tag` and several known family names (gemma,
  // llama3, etc) don't share a single prefix.
  ['ollama',    { baseURL: 'http://localhost:11434/v1', prefixes: ['ollama/'], stripPrefix: 'ollama/' }],
]

// Convenience object form for callers that want {provider: cfg} lookup.
const PROVIDERS = Object.fromEntries(PROVIDERS_ORDERED)

// Ordered list of provider ids whose keys get polled by the UI's key
// status modal. Anthropic first (default), then the rest in display
// order. Ollama is handled specially by `main.js` (runtime availability,
// not an API key), so it's intentionally absent.
const PROVIDER_KEY_IDS = ['anthropic', 'openai', 'google', 'xai', 'kimi', 'moonshot', 'dashscope', 'zhipu', 'minimax', 'hunyuan', 'deepseek']

// Map provider id → env var name. Derived so env-var discovery stays
// synchronised with the registry automatically.
const ENV_MAP = Object.fromEntries(
  PROVIDERS_ORDERED
    .filter(([, cfg]) => cfg.envVar)
    .map(([id, cfg]) => [id, cfg.envVar])
)

/**
 * Route a model id to its provider.
 *
 * Ollama gets checked first via a special-case list because Ollama
 * tags don't share a single prefix — `gemma3:4b`, `qwen3:8b`,
 * `llama3.2:3b`, plain `deepseek-r1`, and anything with a `:` in it
 * all route local. Then the ordered registry is walked for
 * cloud-provider prefix matches. Anthropic is the final fallback.
 *
 * @param {string} model — model id as the UI stores / sends it
 * @returns {string} provider id (e.g. 'openai', 'kimi', 'moonshot')
 */
function detectProvider(model) {
  const m = (model || '').toLowerCase()

  // Ollama special cases. Ordering inside this block doesn't matter.
  if (m.startsWith('ollama/') ||
      m.startsWith('gemma') ||
      m.startsWith('qwen3:') ||     // `:` separates Ollama name and tag.
      m.startsWith('llama3') ||
      m.startsWith('deepseek-r1') ||
      m.includes(':')) {
    return 'ollama'
  }

  // Cloud providers — first match in registry order wins.
  for (const [id, cfg] of PROVIDERS_ORDERED) {
    if (cfg.prefixes.some(p => m.startsWith(p))) return id
  }

  return 'anthropic'
}

/**
 * @param {string} provider
 * @returns {string|undefined} the OpenAI-compatible base URL, or
 *   undefined if the SDK's default should be used.
 */
function getBaseURL(provider) {
  return PROVIDERS[provider]?.baseURL
}

/**
 * Strip routing-hint prefixes from a model id so the SDK sees the raw
 * upstream model name. Preserves case (critical for MiniMax and any
 * other case-sensitive provider) — only the prefix-match comparison is
 * lowercased.
 *
 * @param {string} model
 * @returns {string} model id as the upstream API expects to see it
 */
function normalizeModelId(model) {
  const provider = detectProvider(model)
  const strip = PROVIDERS[provider]?.stripPrefix
  if (!strip) return model
  const m = (model || '').toLowerCase()
  return m.startsWith(strip) ? model.slice(strip.length) : model
}

module.exports = {
  PROVIDERS,
  PROVIDERS_ORDERED,
  PROVIDER_KEY_IDS,
  ENV_MAP,
  detectProvider,
  getBaseURL,
  normalizeModelId,
}
