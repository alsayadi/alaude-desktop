// Standalone test harness — runs the v0.7.1 modules against a mock
// localStorage and a mock Ollama API. No Electron. No GUI. Just verify
// the data layer + logic behaves.

import { MemoryStore } from '/Users/ahmed/Desktop/build/claude/alaude-desktop/renderer/js/memory/memory-store.js'
import { MemoryEmbeddings } from '/Users/ahmed/Desktop/build/claude/alaude-desktop/renderer/js/memory/memory-embeddings.js'
import { MemoryRecall } from '/Users/ahmed/Desktop/build/claude/alaude-desktop/renderer/js/memory/memory-recall.js'
import { MemoryExtract, PROFILE_CATEGORIES } from '/Users/ahmed/Desktop/build/claude/alaude-desktop/renderer/js/memory/memory-extract.js'
import { ProfileStore } from '/Users/ahmed/Desktop/build/claude/alaude-desktop/renderer/js/profile/profile-store.js'

// ── mock storage ─────────────────────────────────────────────────
class FakeStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}

// ── mock Ollama API ──────────────────────────────────────────────
const mockApi = {
  ollamaAvailable: async () => true,
  ollamaFindEmbedModel: async () => 'all-minilm',
  ollamaEmbed: async (texts) => ({
    ok: true,
    model: 'all-minilm',
    // Deterministic pseudo-embedding: 8-dim vector from first 8 char codes
    embeddings: texts.map(t => {
      const v = new Array(8).fill(0)
      for (let i = 0; i < 8; i++) v[i] = (t.charCodeAt(i) || 0) / 128
      return v
    }),
  }),
  ollamaPull: async () => ({ ok: true }),
}

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log('  ✅', label); pass++ }
  else { console.log('  ❌', label, extra); fail++ }
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: MemoryStore — basic CRUD + dedup + scope
// ═══════════════════════════════════════════════════════════════
console.log('\n[1/6] MemoryStore — basic CRUD + scope')
{
  const storage = new FakeStorage()
  const store = new MemoryStore({ storage })

  check('starts empty', store.size() === 0)

  const a = store.add('I prefer Vue', null, { scope: 'global' })
  check('add returns entry with id', a && a.id.startsWith('mem_'))
  check('add assigns scope=global', a.scope === 'global')
  check('add with workspace assigns path',
    store.add('project fact', null, { scope: 'workspace', workspacePath: '/tmp/proj' })?.workspacePath === '/tmp/proj')

  const dup = store.add('I prefer Vue', null, { scope: 'global' })
  check('dedup returns null on same text', dup === null)

  check('size is 2 after one dup', store.size() === 2)

  const persisted = JSON.parse(storage.getItem('alaude:memory:v1'))
  check('save persists to storage', Array.isArray(persisted) && persisted.length === 2)

  // Reload fresh instance and verify it reads what we wrote
  const store2 = new MemoryStore({ storage })
  check('fresh instance reads persisted data', store2.size() === 2)

  const edited = store.edit(a.id, 'I prefer Svelte now')
  check('edit returns true', edited === true)
  check('edit updates text', store.find(a.id).text === 'I prefer Svelte now')

  store.remove(a.id)
  check('remove drops entry', store.size() === 1)
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: MemoryStore — visiblePool scope filter
// ═══════════════════════════════════════════════════════════════
console.log('\n[2/6] MemoryStore — scope filtering')
{
  const store = new MemoryStore({ storage: new FakeStorage() })
  store.add('global fact', null, { scope: 'global' })
  store.add('fact for project A', null, { scope: 'workspace', workspacePath: '/Users/test/projA' })
  store.add('fact for project B', null, { scope: 'workspace', workspacePath: '/Users/test/projB' })
  // Legacy entry (no scope field) — should be treated as global
  store.entries.push({ id: 'legacy_1', text: 'legacy fact', createdAt: Date.now() })
  store.save()

  const poolA = store.visiblePool('/Users/test/projA')
  check('visible pool in projA has global + projA + legacy',
    poolA.length === 3, `got ${poolA.length}, expected 3`)
  check('projA pool does NOT contain projB fact',
    !poolA.some(m => m.text === 'fact for project B'))

  const poolNone = store.visiblePool(null)
  check('visible pool with no workspace has only global + legacy',
    poolNone.length === 2, `got ${poolNone.length}, expected 2`)

  const poolB = store.visiblePool('/Users/test/projB')
  check('visible pool in projB sees projB but not projA',
    poolB.length === 3 && poolB.some(m => m.text === 'fact for project B') && !poolB.some(m => m.text === 'fact for project A'))

  // toggleScope behavior
  const entry = store.add('new workspace fact', null, { scope: 'workspace', workspacePath: '/Users/test/projA' })
  const newScope = store.toggleScope(entry.id, '/Users/test/projA')
  check('toggleScope workspace→global returns global', newScope === 'global')
  check('after toggle, workspacePath is null', store.find(entry.id).workspacePath === null)

  const backToWs = store.toggleScope(entry.id, '/Users/test/projA')
  check('toggleScope global→workspace returns workspace', backToWs === 'workspace')

  // Edge: toggling global→workspace with null workspace returns null
  const globalEntry = store.add('no-ws attempt', null, { scope: 'global' })
  const blocked = store.toggleScope(globalEntry.id, null)
  check('toggleScope blocked when no workspace active', blocked === null)
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: ProfileStore — store + grouping + system block
// ═══════════════════════════════════════════════════════════════
console.log('\n[3/6] ProfileStore — CRUD + grouping + system block')
{
  const storage = new FakeStorage()
  const profile = new ProfileStore({ storage })

  check('starts empty + not onboarded', profile.size() === 0 && profile.shouldShowOnboarding())
  check('getSystemBlock returns empty when no entries', profile.getSystemBlock() === '')

  profile.add('Call me Ahmed', 'identity')
  profile.add('Main stack: Electron, JS', 'tools')
  profile.add('Prefer async/await', 'preferences')
  profile.add('Timezone UTC+3', 'context')

  check('size is 4 after 4 adds', profile.size() === 4)

  const groups = profile.groupedByCategory()
  check('groupedByCategory returns 4 groups', groups.length === 4)
  check('groups ordered identity → preferences → tools → context',
    groups.map(g => g.category).join(',') === 'identity,preferences,tools,context')

  const block = profile.getSystemBlock()
  check('system block wrapped in <user-profile> tags',
    block.startsWith('<user-profile>\n') && block.endsWith('</user-profile>\n\n'))
  check('system block contains the identity fact',
    block.includes('Call me Ahmed'))
  check('system block strips emoji prefix from category label',
    block.includes('[Identity]') && !block.includes('[👤 Identity]'))

  // onboarding state
  profile.markOnboarded()
  check('markOnboarded flips flag', !profile.shouldShowOnboarding())

  // 20-entry cap
  for (let i = 0; i < 25; i++) profile.add(`filler fact ${i}`, 'context')
  check('cap enforced at 20 entries', profile.size() === 20, `got ${profile.size()}`)

  // dedup
  const dup = profile.add('Call me Ahmed', 'identity')
  check('profile dedup returns null', dup === null)
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: MemoryExtract — regex + candidates
// ═══════════════════════════════════════════════════════════════
console.log('\n[4/6] MemoryExtract — patterns + candidates')
{
  const cases = [
    { text: 'My name is Ahmed', expect: 'Name: Ahmed', cat: 'identity', promotes: true },
    { text: 'I prefer Vue over React', expect: 'Prefers Vue over React', cat: 'preferences', promotes: true },
    { text: 'I use Python and Go', expect: 'Uses Python and Go', cat: 'tools', promotes: true },
    { text: "I'm building a chat app", expect: 'Working on a chat app', cat: 'context', promotes: false },
    { text: 'Remember that coffee is life', expect: 'coffee is life', cat: null, promotes: false },
  ]

  for (const c of cases) {
    const facts = MemoryExtract.extract(c.text)
    const matched = facts.some(f => f === c.expect)
    check(`extract("${c.text}") → "${c.expect}"`, matched, `got ${JSON.stringify(facts)}`)

    if (c.cat) {
      const cands = MemoryExtract.extractProfileCandidates(c.text, [])
      const hasCand = cands.some(x => x.text === c.expect && x.category === c.cat)
      if (c.promotes) {
        check(`${c.cat} candidate emitted for promotion`, hasCand)
      } else {
        check(`non-promote pattern did NOT emit candidate`, cands.length === 0 || !hasCand)
      }
    }
  }

  // Existing-profile filter
  const existing = [{ text: 'prefers vue over react', category: 'preferences' }]
  const cands = MemoryExtract.extractProfileCandidates('I prefer Vue over React', existing)
  check('existing profile facts filter out duplicate candidates', cands.length === 0)
}

// ═══════════════════════════════════════════════════════════════
// TEST 5: MemoryEmbeddings — cosine + backfill
// ═══════════════════════════════════════════════════════════════
console.log('\n[5/6] MemoryEmbeddings — cosine + backfill loop')
{
  const store = new MemoryStore({ storage: new FakeStorage() })
  const emb = new MemoryEmbeddings({ store, api: mockApi })

  check('cosine of identical vectors ≈ 1',
    Math.abs(MemoryEmbeddings.cosine([1, 0, 0], [1, 0, 0]) - 1) < 0.0001)
  check('cosine of orthogonal vectors = 0',
    MemoryEmbeddings.cosine([1, 0, 0], [0, 1, 0]) === 0)
  check('cosine of mismatched dims = 0',
    MemoryEmbeddings.cosine([1, 0], [1, 0, 0]) === 0)

  store.add('apple banana', null, { scope: 'global' })
  store.add('apricot berry', null, { scope: 'global' })
  store.add('zebra xylophone', null, { scope: 'global' })

  const r = await emb.ensureAll()
  check('ensureAll completes against mock ollama', r.started === true, JSON.stringify(r))
  check('all entries got embeddings', store.embeddedCount() === 3)

  // second call → nothing to do
  const r2 = await emb.ensureAll()
  check('re-running ensureAll skips (already-indexed)', r2.started === false && r2.reason === 'all-indexed')
}

// ═══════════════════════════════════════════════════════════════
// TEST 6: MemoryRecall — scoring + profile injection
// ═══════════════════════════════════════════════════════════════
console.log('\n[6/6] MemoryRecall — scoring + injection')
{
  const store = new MemoryStore({ storage: new FakeStorage() })
  const emb = new MemoryEmbeddings({ store, api: mockApi })
  let incog = false
  const recall = new MemoryRecall({
    store, embeddings: emb,
    getIncognito: () => incog,
    getCurrentWorkspace: () => null,
  })

  store.add('User prefers dark mode', null, { scope: 'global' })
  store.add('User uses Python for ML', null, { scope: 'global' })
  store.add('User is a developer', null, { scope: 'global' })

  // Keyword mode only
  store.setRecallMode('keyword')
  const kwHits = await recall.recall('What does the user prefer about mode settings?', 5)
  check('keyword recall returns at least one hit',
    kwHits.length >= 1, `got ${kwHits.length}`)

  // Incognito should always return []
  incog = true
  const incogHits = await recall.recall('prefers anything', 5)
  check('incognito suppresses recall', incogHits.length === 0)
  incog = false

  // injectIntoLastUser — with profile block
  const messages = [
    { role: 'user', content: 'what do I prefer?' },
  ]
  const profileBlockBuilder = () => '<user-profile>\n- [Identity] Ahmed\n</user-profile>\n\n'
  const injected = await recall.injectIntoLastUser(messages, 'prefers', profileBlockBuilder)
  check('inject returns profileUsed=true when profile given', injected.profileUsed === true)
  check('injected message starts with <user-profile>',
    injected.msgs[0].content.startsWith('<user-profile>'))

  // Incognito kills profile injection too
  incog = true
  const injectedIncog = await recall.injectIntoLastUser(messages, 'prefers', profileBlockBuilder)
  check('incognito blocks profile injection',
    injectedIncog.profileUsed === false)
}

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(60))
console.log(`  RESULTS: ${pass} passed, ${fail} failed`)
console.log('━'.repeat(60))
if (fail > 0) process.exit(1)
