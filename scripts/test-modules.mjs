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
console.log('\n[1/13] MemoryStore — basic CRUD + scope')
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
console.log('\n[2/13] MemoryStore — scope filtering')
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
console.log('\n[3/13] ProfileStore — CRUD + grouping + system block')
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
console.log('\n[4/13] MemoryExtract — patterns + candidates')
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
console.log('\n[5/13] MemoryEmbeddings — cosine + backfill loop')
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
console.log('\n[6/13] MemoryRecall — scoring + injection')
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
// TEST 7: folder-skills — discovery, frontmatter, guards
// (CJS module; loaded with LABAIK_HOME pointed at a temp dir so the
// test never touches ~/.labaik.)
// ═══════════════════════════════════════════════════════════════
console.log('\n[7/13] folder-skills — discovery + frontmatter + guards')
{
  const { createRequire } = await import('node:module')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const require = createRequire(import.meta.url)

  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-test-'))
  process.env.LABAIK_HOME = testHome
  // paths.js caches BASE_DIR at load — must require AFTER setting the env.
  const folderSkills = require('../electron/folder-skills.js')

  check('discover returns [] when root missing', folderSkills.discover().length === 0)

  const mkSkill = (slug, content) => {
    fs.mkdirSync(path.join(testHome, 'skills', slug), { recursive: true })
    fs.writeFileSync(path.join(testHome, 'skills', slug, 'SKILL.md'), content)
  }
  mkSkill('pr-polish', '---\nname: Polish a PR\ndescription: Clean up a PR body\n---\n\nRewrite the PR description…')
  mkSkill('no-front', 'Just a body, no frontmatter.')
  fs.mkdirSync(path.join(testHome, 'skills', 'empty-dir'))  // no SKILL.md — ignored

  const found = folderSkills.discover()
  check('discovers 2 skills (ignores empty dir)', found.length === 2, `got ${found.length}`)
  const pr = found.find(s => s.slug === 'pr-polish')
  check('frontmatter name parsed', pr?.name === 'Polish a PR')
  check('frontmatter description parsed', pr?.description === 'Clean up a PR body')
  check('body excludes frontmatter', pr?.body.startsWith('Rewrite the PR description'))
  check('no-frontmatter slug becomes name', found.find(s => s.slug === 'no-front')?.name === 'no-front')

  check('get() loads by slug', folderSkills.get('pr-polish')?.name === 'Polish a PR')
  check('get() rejects path traversal', folderSkills.get('../outside') === null)
  check('get() unknown slug → null', folderSkills.get('nope') === null)

  // Starter skills (v0.8 general-use)
  const first = folderSkills.installStarters()
  check('installStarters installs all bundled skills',
    first.installed.length === folderSkills.STARTER_SKILLS.length && first.skipped.length === 0)
  check('starter skill discoverable with parsed frontmatter',
    folderSkills.get('meeting-notes')?.description.includes('action items'))
  // Idempotency: user edits must survive a re-install.
  fs.writeFileSync(path.join(testHome, 'skills', 'trip-planner', 'SKILL.md'), '---\nname: Mine\n---\nedited')
  const second = folderSkills.installStarters()
  check('re-install skips everything (idempotent)', second.installed.length === 0)
  check('user-edited starter not overwritten', folderSkills.get('trip-planner')?.name === 'Mine')

  const { meta, body } = folderSkills._parseFrontmatter('---\nName: "Quoted"\n---\nbody')
  check('frontmatter keys lowercase + quotes stripped', meta.name === 'Quoted' && body === 'body')

  // ═══ TEST 8: routines — cron parse + legacy shape ═══
  console.log('\n[8/13] routines — cron parsing + legacy skills.json shape')
  const routines = require('../electron/routines.js')
  check('parses standard cron', routines._parseCron('0 8 * * *') !== null)
  check('rejects 4-field cron', routines._parseCron('0 8 * *') === null)
  const next = routines._nextFire('*/15 * * * *', Date.now())
  check('nextFire lands within 15 min', next !== null && next - Date.now() <= 15 * 60 * 1000)
  // Legacy shape: a migrated skills.json still loads.
  fs.writeFileSync(path.join(testHome, 'routines.json'),
    JSON.stringify({ version: 1, skills: [{ id: 'sk_1', name: 'Old', prompt: 'p', cron: '0 8 * * *', enabled: true }] }))
  const listed = routines.list()
  check('legacy {skills:[…]} shape accepted', listed.length === 1 && listed[0].name === 'Old')
  routines.upsert({ name: 'New one', prompt: 'p2', cron: '0 9 * * *' })
  const onDisk = JSON.parse(fs.readFileSync(path.join(testHome, 'routines.json'), 'utf8'))
  check('save writes routines key (not skills)', Array.isArray(onDisk.routines) && onDisk.routines.length === 2 && !onDisk.skills)
  check('new ids use rt_ prefix', onDisk.routines[1].id.startsWith('rt_'))

  // ═══ TEST 9: ChatGPT import converter ═══
  console.log('\n[9/13] import-chatgpt — mapping linearization')
  const { convertChatGPTExport, fingerprint } = require('../electron/import-chatgpt.js')
  const mkExport = () => ([{
    title: 'Test conv', create_time: 1700000000, current_node: 'n3',
    mapping: {
      n0: { id: 'n0', parent: null, children: ['n1'], message: { author: { role: 'system' }, content: { parts: ['sys'] } } },
      n1: { id: 'n1', parent: 'n0', children: ['n2'], message: { author: { role: 'user' }, content: { parts: ['hello'] }, create_time: 1700000001 } },
      n2: { id: 'n2', parent: 'n1', children: ['n3'], message: { author: { role: 'assistant' }, content: { parts: ['hi there'] }, create_time: 1700000002 } },
      n3: { id: 'n3', parent: 'n2', children: [], message: { author: { role: 'user' }, content: { parts: ['bye'] } } },
    },
  }, { title: 'Empty', current_node: 'x', mapping: {} }])
  const conv = convertChatGPTExport(mkExport())
  check('converts the active thread in order',
    conv.ok && conv.sessions.length === 1 &&
    conv.sessions[0].messages.map(m => m.content).join('|') === 'hello|hi there|bye')
  check('system messages dropped', !conv.sessions[0].messages.some(m => m.role !== 'user' && m.role !== 'assistant'))
  check('empty conversation skipped, counted', conv.skipped === 1)
  check('wrapped {conversations:[...]} accepted', convertChatGPTExport({ conversations: mkExport() }).ok)
  check('garbage input rejected gracefully', convertChatGPTExport({ nope: 1 }).ok === false)
  // Cycle 39: dedup fingerprints. Same export → identical fps (stable);
  // different content → different fp; converter stamps fp on each session.
  check('converter stamps a fingerprint', typeof conv.sessions[0].fp === 'string' && conv.sessions[0].fp.length > 0)
  check('re-converting the same export yields identical fingerprints',
    convertChatGPTExport(mkExport()).sessions[0].fp === conv.sessions[0].fp)
  check('different conversation → different fingerprint',
    fingerprint({ title: 'A', messages: [{ role: 'user', content: 'x' }] }) !==
    fingerprint({ title: 'B', messages: [{ role: 'user', content: 'x' }] }))
  check('fingerprint reflects message count',
    fingerprint({ title: 'A', messages: [{ role: 'user', content: 'x' }] }) !==
    fingerprint({ title: 'A', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }))

  // ═══ TEST 10: backup round-trip ═══
  console.log('\n[10/13] backup — export/import round-trip, keys excluded')
  const backup = require('../electron/backup.js')
  fs.writeFileSync(path.join(testHome, 'sessions.json'), JSON.stringify({ v: 1, sessions: [{ id: 1, title: 'keep me' }] }))
  fs.writeFileSync(path.join(testHome, 'credentials.json'), JSON.stringify({ secret: 'sk-DO-NOT-EXPORT' }))
  const bundle = backup.exportBundle({ snippets: ['x'] })
  check('bundle carries sessions', bundle.files['sessions.json']?.sessions?.[0]?.title === 'keep me')
  check('bundle carries skills', bundle.skills.some(sk => sk.slug === 'pr-polish'))
  check('credentials NEVER exported', !JSON.stringify(bundle).includes('sk-DO-NOT-EXPORT'))
  check('renderer extras ride along', bundle.renderer?.snippets?.[0] === 'x')
  // Mutate, then restore
  fs.writeFileSync(path.join(testHome, 'sessions.json'), JSON.stringify({ v: 1, sessions: [] }))
  const imp = backup.importBundle(bundle)
  check('import restores sessions', imp.ok && JSON.parse(fs.readFileSync(path.join(testHome, 'sessions.json'), 'utf8')).sessions[0].title === 'keep me')
  check('overwritten file backed up first', fs.readdirSync(testHome).some(f => f.startsWith('sessions.json.pre-import-')))
  check('garbage bundle rejected', backup.importBundle({ nope: 1 }).ok === false)
  check('future-version bundle rejected', backup.importBundle({ kind: 'labaik-backup', version: 99 }).ok === false)

  // Cycle 29: non-destructive merge. Local has a session the bundle lacks +
  // an older copy of a shared one; restore must keep the local-only session
  // and take the bundle's more-complete copy of the shared one.
  fs.writeFileSync(path.join(testHome, 'sessions.json'), JSON.stringify({ v: 1, sessions: [
    { id: 1, title: 'keep me', messages: [{ role: 'user', content: 'a' }] },
    { id: 2, title: 'local only', messages: [{ role: 'user', content: 'mine' }] },
  ] }))
  const mergeBundle = { kind: 'labaik-backup', version: 1, files: { 'sessions.json': { v: 1, sessions: [
    { id: 1, title: 'keep me', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
    { id: 3, title: 'from backup', messages: [{ role: 'user', content: 'c' }] },
  ] } }, skills: [] }
  const merged = backup.importBundle(mergeBundle)
  const after = JSON.parse(fs.readFileSync(path.join(testHome, 'sessions.json'), 'utf8')).sessions
  check('merge keeps local-only session', after.some(s => s.id === 2 && s.title === 'local only'))
  check('merge adds backup-only session', after.some(s => s.id === 3))
  check('merge takes the more-complete shared copy', after.find(s => s.id === 1)?.messages.length === 2)
  check('merge reports new session count', merged.mergedSessions === 1)

  // ═══ TEST 11: conversation history budget ═══
  console.log('\n[11/13] history-budget — cap, keep-recent, trim note')
  const { capHistory } = await import('../renderer/js/history-budget.js')
  const mk = (n, len) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(len) }))
  // Under budget → unchanged (new array)
  const small = mk(6, 100)
  const r1 = capHistory(small, 240000)
  check('under-budget history passes through unchanged', r1.length === 6 && r1 !== small && r1[0].content === small[0].content)
  // ≤ minKeep always passes
  check('<=minKeep history never trimmed', capHistory(mk(3, 999999), 10).length === 3)
  // Over budget → trims oldest, prepends note, keeps newest
  const big = mk(50, 10000)  // 500k chars
  big[49].content = 'NEWEST'
  const r2 = capHistory(big, 100000, 4)
  check('over-budget history is trimmed', r2.length < 50)
  check('trim keeps the newest message', r2[r2.length - 1].content === 'NEWEST')
  check('trim prepends a note', r2[0].role === 'user' && r2[0].content.includes('trimmed'))
  check('note reports a plausible dropped count', /\d+ earlier message/.test(r2[0].content))
  // Always keeps at least minKeep even if each is oversize
  check('keeps >= minKeep huge messages', capHistory(mk(10, 500000), 100000, 4).filter(m => m.content.length === 500000).length >= 4)
  // Never mutates input
  check('input array not mutated', big.length === 50)

  // ═══ TEST 12: MCP tool-name parser ═══
  console.log('\n[12/13] mcp — tool-name parsing')
  const { parseMcpToolName } = require('../electron/mcp.js')
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('parses simple name', eq(parseMcpToolName('mcp_fs__read_file'), { serverName: 'fs', toolName: 'read_file' }))
  check('server name with underscore', eq(parseMcpToolName('mcp_my_server__do_thing'), { serverName: 'my_server', toolName: 'do_thing' }))
  check('tool name with double underscore (splits on first __)', eq(parseMcpToolName('mcp_gh__list__repos'), { serverName: 'gh', toolName: 'list__repos' }))
  check('rejects non-mcp prefix', parseMcpToolName('notmcp_x__y') === null)
  check('rejects empty server', parseMcpToolName('mcp___y') === null)
  check('rejects empty tool', parseMcpToolName('mcp_fs__') === null)
  check('rejects non-string', parseMcpToolName(null) === null)

  // ═══ TEST 13: permissions — rm -rf detection across flag spellings ═══
  console.log('\n[13/13] permissions — dangerous rm detection')
  const perms = require('../electron/permissions.js')
  const rmClass = (c) => perms.classifyCommand(c).class
  check('rm -rf flagged', rmClass('rm -rf /tmp/x') === 'dangerous')
  check('rm -r -f (split) flagged', rmClass('rm -r -f ./build') === 'dangerous')
  check('rm --recursive --force flagged', rmClass('rm --recursive --force .') === 'dangerous')
  check('rm -f -r (reordered) flagged', rmClass('rm -f -r data') === 'dangerous')
  check('rm -fr (combined alt) flagged', rmClass('rm -fr x') === 'dangerous')
  check('chained rm -r -f flagged', rmClass('echo hi && rm -r -f ./node_modules') === 'dangerous')
  check('rm with force only NOT flagged', rmClass('rm --force ./file') !== 'dangerous')
  check('rm recursive only NOT flagged', rmClass('rm -r ./dir') !== 'dangerous')
  check('rm of a single file NOT flagged', rmClass('rm file.txt') !== 'dangerous')
  check('word containing rm NOT flagged', rmClass('confirm-rm script') !== 'dangerous')
  check('isDangerousRm exported + works', perms.isDangerousRm('rm -r -f x') === true && perms.isDangerousRm('ls') === false)
  // Cycle 44: force-push + recursive-chmod detection regardless of flag position/spelling
  check('git push --force (flag first) flagged', rmClass('git push --force origin main') === 'dangerous')
  check('git push ... --force (flag last) flagged', rmClass('git push origin main --force') === 'dangerous')
  check('git push refspec +branch flagged', rmClass('git push origin +main') === 'dangerous')
  check('git push --force-with-lease flagged', rmClass('git push --force-with-lease') === 'dangerous')
  check('plain git push NOT flagged', rmClass('git push origin main') !== 'dangerous')
  check('chmod -fR (combined) flagged', rmClass('chmod -fR 777 x') === 'dangerous')
  check('chmod --recursive flagged', rmClass('chmod --recursive 777 x') === 'dangerous')
  check('chmod non-recursive NOT flagged', rmClass('chmod 644 file') !== 'dangerous')
  check('no cross-segment bleed (push then ls -R)', rmClass('git push origin main && ls -R') !== 'dangerous')

  fs.rmSync(testHome, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(60))
console.log(`  RESULTS: ${pass} passed, ${fail} failed`)
console.log('━'.repeat(60))
if (fail > 0) process.exit(1)
