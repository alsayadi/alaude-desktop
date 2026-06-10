/**
 * ChatGPT export converter — pure logic, no Electron.
 *
 * Input: the parsed conversations.json from a ChatGPT data export
 * (Settings → Data controls → Export data). Either a bare array of
 * conversations or { conversations: [...] }.
 *
 * Each conversation's `mapping` is a node tree (id → { message, parent,
 * children }); the active thread is linearized by walking parent links
 * from `current_node` and reversing — branches that were edited away are
 * intentionally dropped, matching what the user saw in ChatGPT.
 *
 * Output: { ok, sessions: [{ title, createdAt, messages: [{role, content,
 * ts?}] }], skipped } — renderer-neutral; the caller maps to its own
 * session shape.
 */

function convertChatGPTExport(data) {
  const convs = Array.isArray(data) ? data : (Array.isArray(data?.conversations) ? data.conversations : null)
  if (!convs) return { ok: false, reason: 'Not a ChatGPT conversations.json (expected an array of conversations)' }
  const sessions = []
  let skipped = 0
  for (const conv of convs) {
    try {
      const mapping = conv.mapping || {}
      let node = mapping[conv.current_node]
      const msgs = []
      let guard = 0
      while (node && guard++ < 5000) {
        const m = node.message
        const role = m?.author?.role
        const parts = m?.content?.parts
        if ((role === 'user' || role === 'assistant') && Array.isArray(parts)) {
          const text = parts.filter((x) => typeof x === 'string').join('\n').trim()
          if (text) msgs.push({ role, content: text, ts: m.create_time ? Math.round(m.create_time * 1000) : undefined })
        }
        node = node.parent ? mapping[node.parent] : null
      }
      msgs.reverse()
      if (!msgs.length) { skipped++; continue }
      sessions.push({
        title: String(conv.title || 'Imported chat').slice(0, 120),
        createdAt: conv.create_time ? Math.round(conv.create_time * 1000) : Date.now(),
        messages: msgs,
      })
    } catch { skipped++ }
  }
  return { ok: true, sessions, skipped }
}

module.exports = { convertChatGPTExport }
