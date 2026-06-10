// Conversation history budget (v0.8 cycle 33, extracted + tested cycle 34).
//
// The whole conversation used to be re-sent to the provider on every turn
// with no ceiling — the dominant token cost on long sessions and a cause of
// "context length exceeded" errors. capHistory keeps the most recent turns
// within a generous character budget; if older turns are dropped it leads
// with a one-line note so the model knows context was trimmed.
//
// Pure + dependency-free so scripts/test-modules.mjs can exercise the exact
// code the renderer runs. The renderer imports this in a <script type=module>
// and assigns window.capHistoryFn; sanitizeHistoryForApi delegates to it.
//
// Contract:
//   - msgs: array of { role, content } (content string or array)
//   - returns a NEW array; never mutates input
//   - sessions within budget, or ≤ minKeep messages, pass through unchanged
//   - always keeps at least `minKeep` most-recent messages, even if oversize
//   - when anything is dropped, index 0 is a synthetic user note

export const DEFAULT_HISTORY_CHAR_BUDGET = 240000  // ~60k tokens

function sizeOf(m) {
  return typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
}

export function capHistory(msgs, budget = DEFAULT_HISTORY_CHAR_BUDGET, minKeep = 4) {
  if (!Array.isArray(msgs)) return []
  let total = 0
  for (const m of msgs) total += sizeOf(m)
  if (total <= budget || msgs.length <= minKeep) return msgs.slice()

  const kept = []
  let used = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const sz = sizeOf(msgs[i])
    if (used + sz > budget && kept.length >= minKeep) break
    kept.unshift(msgs[i])
    used += sz
  }
  const dropped = msgs.length - kept.length
  if (dropped > 0) {
    kept.unshift({
      role: 'user',
      content: `[Note: ${dropped} earlier message(s) in this long conversation were trimmed to stay within context limits and save tokens. Ask me to re-share anything older if you need it.]`,
    })
  }
  return kept
}
