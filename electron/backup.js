/**
 * Backup & restore — one portable JSON bundle for everything a user would
 * cry about losing: sessions, memory, profile, routines, spaces, and folder
 * skills. CREDENTIALS ARE EXCLUDED BY DESIGN — a backup file may travel
 * over AirDrop/cloud drives; keys never should.
 *
 * Import is non-destructive: every file it would overwrite is first copied
 * to <name>.pre-import-<ts> alongside the original.
 */

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const BUNDLE_VERSION = 1
const FILES = ['sessions.json', 'memory.json', 'profile.json', 'routines.json', 'spaces.json']

function exportBundle(rendererExtras = null) {
  const bundle = {
    kind: 'labaik-backup',
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    files: {},
    skills: [],
    renderer: rendererExtras || null,
  }
  for (const name of FILES) {
    try {
      const p = path.join(paths.BASE_DIR, name)
      if (fs.existsSync(p)) bundle.files[name] = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch { /* unreadable file — skip rather than abort the whole backup */ }
  }
  try {
    const skillsRoot = path.join(paths.BASE_DIR, 'skills')
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sp = path.join(skillsRoot, entry.name, 'SKILL.md')
      if (fs.existsSync(sp)) bundle.skills.push({ slug: entry.name, content: fs.readFileSync(sp, 'utf8') })
    }
  } catch { /* no skills dir */ }
  return bundle
}

function importBundle(bundle) {
  if (!bundle || bundle.kind !== 'labaik-backup' || typeof bundle.version !== 'number') {
    return { ok: false, reason: 'Not a Labaik backup file.' }
  }
  if (bundle.version > BUNDLE_VERSION) {
    return { ok: false, reason: `Backup is from a newer Labaik (v${bundle.version}) — update the app first.` }
  }
  const ts = Date.now().toString(36)
  const restored = []
  for (const name of FILES) {
    const data = bundle.files?.[name]
    if (data === undefined) continue
    try {
      const p = path.join(paths.BASE_DIR, name)
      fs.mkdirSync(paths.BASE_DIR, { recursive: true })
      if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.pre-import-${ts}`)
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
      restored.push(name)
    } catch { /* skip the file, keep going */ }
  }
  let skillsRestored = 0
  for (const sk of bundle.skills || []) {
    if (!sk?.slug || /[/\\]/.test(sk.slug)) continue  // traversal guard
    try {
      const dir = path.join(paths.BASE_DIR, 'skills', sk.slug)
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const sp = path.join(dir, 'SKILL.md')
      if (fs.existsSync(sp)) fs.copyFileSync(sp, `${sp}.pre-import-${ts}`)
      fs.writeFileSync(sp, String(sk.content || ''), 'utf8')
      skillsRestored++
    } catch {}
  }
  return { ok: true, restored, skillsRestored, renderer: bundle.renderer || null }
}

module.exports = { exportBundle, importBundle, BUNDLE_VERSION, FILES }
