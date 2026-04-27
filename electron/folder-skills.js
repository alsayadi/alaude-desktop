/**
 * folder-skills — minimal directory-based skill discovery.
 *
 * v0.7.67 introduces a lightweight convention: drop a folder under
 *   ~/.labaik/skills/<slug>/
 * containing a SKILL.md file, and Labaik will pick it up at runtime
 * with no JSON registration, no app restart, no settings UI.
 *
 * SKILL.md format (YAML frontmatter optional, all keys optional):
 *
 *     ---
 *     name: Polish a PR description
 *     description: Reformat raw git log into a clean PR body
 *     ---
 *
 *     # Skill body — markdown freeform.
 *     # Whatever the user wants the model to do when they pick this skill.
 *     # The body is what gets injected into the composer when the skill is
 *     # selected from the command palette.
 *
 * If the frontmatter is missing or unparseable, the slug becomes the name
 * and the description stays empty — discovery NEVER throws on bad input,
 * it just degrades to "untitled skill" so a single broken folder doesn't
 * black-hole the rest of the user's library.
 *
 * The body is the markdown after the closing `---` (or the whole file if
 * there's no frontmatter). It's what gets prepended to the user's next
 * message when the skill fires.
 *
 * NOT a cron-routine: routines (electron/skills.js) are scheduled prompts.
 * Folder skills are user-callable templates. Different concept, different
 * file. The naming overlap is unfortunate but historical.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const SKILLS_ROOT = path.join(os.homedir(), '.labaik', 'skills')
const MAX_BODY_BYTES = 64 * 1024  // 64KB per skill — same order as AGENTS.md

/**
 * Parse a leading YAML-lite frontmatter block (`---` … `---`).
 * Only handles `key: value` lines — no nesting, no arrays. That's deliberate;
 * we want a 30-line parser, not a YAML dependency.
 *
 * Returns { meta: {...}, body: '...' }. If no frontmatter, meta is {} and
 * body is the entire file.
 */
function _parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  // Find the closing ---. Must be on its own line.
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }  // malformed; treat as no frontmatter
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/)
    if (!kv) continue
    let v = kv[2]
    // Strip wrapping quotes if present (single or double)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    meta[kv[1].toLowerCase()] = v
  }
  return { meta, body: m[2] }
}

/**
 * Scan SKILLS_ROOT for SKILL.md files (one level deep) and return the
 * discovered skills. Resilient to: missing root dir, unreadable folders,
 * bad frontmatter, oversize bodies. Failures degrade silently — one bad
 * skill doesn't poison the list.
 *
 * Returns an array sorted by name (case-insensitive).
 */
function discover() {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
  } catch { return [] }  // root dir doesn't exist yet — return empty silently

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    if (slug.startsWith('.')) continue  // hide dotfiles
    const skillPath = path.join(SKILLS_ROOT, slug, 'SKILL.md')
    let raw = ''
    try {
      const stat = fs.statSync(skillPath)
      if (!stat.isFile()) continue
      raw = fs.readFileSync(skillPath, 'utf8')
    } catch { continue }  // no SKILL.md or unreadable — skip

    const { meta, body } = _parseFrontmatter(raw)
    let trimmedBody = body.trim()
    const originalLen = trimmedBody.length
    if (trimmedBody.length > MAX_BODY_BYTES) {
      trimmedBody = trimmedBody.slice(0, MAX_BODY_BYTES) +
        `\n\n[…truncated ${originalLen - MAX_BODY_BYTES} chars on load — keep SKILL.md under ${MAX_BODY_BYTES / 1024}KB]`
    }
    out.push({
      slug,
      name: String(meta.name || slug).slice(0, 120),
      description: String(meta.description || '').slice(0, 240),
      body: trimmedBody,
      bytes: originalLen,
      path: skillPath,
    })
  }

  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return out
}

/**
 * Get a single skill by slug. Useful if the renderer wants to lazy-load a
 * body without round-tripping the full list.
 */
function get(slug) {
  if (!slug || /[/\\]/.test(slug)) return null  // path-traversal guard
  const skillPath = path.join(SKILLS_ROOT, slug, 'SKILL.md')
  let raw = ''
  try {
    const stat = fs.statSync(skillPath)
    if (!stat.isFile()) return null
    raw = fs.readFileSync(skillPath, 'utf8')
  } catch { return null }
  const { meta, body } = _parseFrontmatter(raw)
  return {
    slug,
    name: String(meta.name || slug).slice(0, 120),
    description: String(meta.description || '').slice(0, 240),
    body: body.trim().slice(0, MAX_BODY_BYTES),
    path: skillPath,
  }
}

/**
 * Return the absolute path of the skills root directory. Renderer surfaces
 * this in the empty-state hint so users know exactly where to drop folders.
 */
function getRoot() {
  return SKILLS_ROOT
}

/**
 * Ensure the root directory exists. Called once on first IPC list call so
 * a user with zero skills still gets a target dir + sample created.
 */
function ensureRoot() {
  try {
    fs.mkdirSync(SKILLS_ROOT, { recursive: true, mode: 0o700 })
    // Drop a README on first creation so the dir isn't empty + mysterious.
    const readmePath = path.join(SKILLS_ROOT, 'README.md')
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath,
`# Labaik folder-skills

Each subdirectory here is one "skill" — a reusable prompt template Labaik
shows in the command palette (Cmd-K). Format:

    ~/.labaik/skills/<slug>/
        SKILL.md

Inside SKILL.md:

    ---
    name: My skill name
    description: One-line description for the palette
    ---

    The full skill body — markdown. When the user picks this skill,
    this body gets inserted into the composer.

That's the whole spec. No frontmatter? slug becomes the name. No SKILL.md?
the folder is ignored. One bad skill never poisons the others.
`, 'utf8')
    }
  } catch { /* permission errors etc — not fatal */ }
}

module.exports = {
  discover,
  get,
  getRoot,
  ensureRoot,
  _parseFrontmatter,  // exposed for tests
}
