/**
 * model-extras — decide which discovered models deserve a row in the picker.
 *
 * The curated <select> in index.html is a snapshot of what existed when the
 * build shipped. electron/model-discovery.js asks each provider what the
 * user's own key can actually see; this module decides what to do with the
 * answer.
 *
 * It lives here, separate from the DOM code, for one practical reason: the
 * preload bridge (`window.alaude`) is frozen by contextBridge, so a live
 * browser test cannot stub the discovery response. Keeping the decision
 * pure means it can be tested directly instead of not at all.
 */

/**
 * @param {Record<string,string[]>} discovered  provider id → model ids
 * @param {Set<string>|string[]} knownIds       ids already in the picker
 * @param {(id:string)=>string} providerOf      the renderer's router
 * @param {number} [limit]                      hard cap on the extra group
 * @returns {string[]} sorted ids to append, never containing a known id
 */
export function pickDiscoveredExtras(discovered, knownIds, providerOf, limit = 60) {
  const known = new Set(
    (knownIds instanceof Set ? [...knownIds] : (knownIds || []))
      .map(v => String(v || '').toLowerCase())
  )
  const extras = []
  for (const [provider, ids] of Object.entries(discovered || {})) {
    for (const id of ids || []) {
      if (!id || typeof id !== 'string') continue
      const lc = id.toLowerCase()
      if (known.has(lc)) continue
      // Only offer ids our own router agrees belong to this provider. A
      // mismatch means the request would be signed with the wrong key and
      // fail confusingly — better to leave it out than to offer a trap.
      // (Providers do return foreign ids: OpenAI-compatible gateways list
      // models they proxy, and some list a rival's name for comparison.)
      let routed
      try { routed = providerOf(id) } catch { continue }
      if (routed !== provider) continue
      known.add(lc)
      extras.push(id)
    }
  }
  return extras.sort().slice(0, limit)
}
