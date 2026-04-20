// MemoryExtract — heuristic fact extraction from user messages.
//
// Two exports:
//   - extract(text)             → string[]  (episodic facts, legacy behavior)
//   - extractProfileCandidates  → Array<{ text, category }> (promote chips)
//
// Patterns are precision-biased. Each one tags its category + whether the
// pattern is eligible for profile promotion via the approval chip. Strong-
// signal patterns (identity / tools / preferences) promote; weaker patterns
// (context) stay in episodic only.

export const PROFILE_CATEGORIES = [
  { id: 'identity', label: '👤 Identity', hint: 'Name, role, location, language' },
  { id: 'preferences', label: '💡 Preferences', hint: 'Coding style, tone, conventions' },
  { id: 'tools', label: '🛠️ Tools', hint: 'Languages, frameworks, editors you use' },
  { id: 'context', label: '📌 Context', hint: 'Anything else you want Labaik to always know' },
]

const TECH_ALTERNATION = [
  'Python','JavaScript','TypeScript','Rust','Go','Ruby','Java','C\\+\\+','C#',
  'Swift','Kotlin','PHP','Elixir','Clojure','Haskell','Zig',
  'React','Vue','Svelte','Next\\.js','Django','Rails','Flask','Electron',
  'Node\\.js','Deno','Bun','Postgres','MySQL','SQLite','Redis',
].join('|')

const PATTERNS = [
  {
    re: /\b(?:my name is|i(?:'m| am) called|call me)\s+([A-Z][a-zA-Z' -]{1,30})/i,
    tpl: (m) => `Name: ${m[1].trim()}`,
    category: 'identity',
    promote: true,
  },
  {
    re: /\bi(?:'m| am)\s+(a|an)\s+([a-z][a-z\s]{2,40}?)(?:[.,]|$| who | and | working | at )/i,
    tpl: (m) => `Is ${m[1]} ${m[2].trim()}`,
    category: 'identity',
    promote: true,
  },
  {
    // Dynamically-built tech list. Matches "I use X", "I code in X, Y and Z".
    re: new RegExp(
      `\\bi\\s+(?:use|work with|code in|write)\\s+((?:${TECH_ALTERNATION})` +
      `(?:(?:,|\\s+and\\s+)\\s*(?:${TECH_ALTERNATION})){0,4})`,
      'i'
    ),
    tpl: (m) => `Uses ${m[1].trim()}`,
    category: 'tools',
    promote: true,
  },
  {
    re: /\bi\s+(?:prefer|like|love|favor)\s+([a-zA-Z0-9][^.?!]{3,80}?)(?:[.?!]|$)/i,
    tpl: (m) => `Prefers ${m[1].trim()}`,
    category: 'preferences',
    promote: true,
  },
  {
    re: /\bi(?:'m| am)\s+(?:working on|building|developing|shipping)\s+([a-zA-Z0-9][^.?!]{3,80}?)(?:[.?!]|$)/i,
    tpl: (m) => `Working on ${m[1].trim()}`,
    category: 'context',
    promote: false,
  },
  {
    re: /\bi\s+work\s+(?:at|for)\s+([A-Z][a-zA-Z0-9& .'-]{1,40}?)(?:[.,]|$)/i,
    tpl: (m) => `Works at ${m[1].trim()}`,
    category: 'identity',
    promote: true,
  },
  {
    re: /\b(?:my|our)\s+(?:team|company|project|stack)\s+(?:is|uses)\s+([a-zA-Z0-9][^.?!]{3,80}?)(?:[.?!]|$)/i,
    tpl: (m) => `Team/project: ${m[1].trim()}`,
    category: 'context',
    promote: false,
  },
]

// Imperative ("Remember that I like X") takes priority over the patterns —
// user was explicit. Captured raw text is trimmed of trailing punctuation.
const IMPERATIVE = /^\s*(?:remember(?:\s+that)?|note(?:\s+that)?|keep in mind|fyi)[,:\s]+(.{4,200})$/i

export const MemoryExtract = {
  extract(userText) {
    if (!userText) return []
    const found = []
    const imp = userText.match(IMPERATIVE)
    if (imp) found.push(imp[1].trim().replace(/[.!?]+$/, ''))
    for (const p of PATTERNS) {
      const m = userText.match(p.re)
      if (m) found.push(p.tpl(m))
    }
    return found
  },

  // Promote-chip candidates. Excludes anything already in the profile so
  // the chip doesn't re-surface known facts.
  extractProfileCandidates(userText, existingProfile = []) {
    if (!userText) return []
    const out = []
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ')
    const seen = new Set(existingProfile.map(p => norm(p.text)))
    for (const p of PATTERNS) {
      if (!p.promote) continue
      const m = userText.match(p.re)
      if (!m) continue
      const text = p.tpl(m)
      if (seen.has(norm(text))) continue
      out.push({ text, category: p.category })
    }
    return out
  },
}
