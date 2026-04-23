/**
 * paths — canonical on-disk locations for Labaik data.
 *
 * WHY THIS FILE EXISTS
 *   Pre-v0.7.64, Labaik wrote data to three separate places:
 *     ~/.claude/            — legacy, shared with Claude Code CLI on some
 *                              machines (bad: mixes two tools' private data)
 *                              Held: .credentials.json, alaude-events.ndjson,
 *                                    alaude-ooda-state.json, alaude-spaces.json,
 *                                    alaude-ux-proposals.md
 *     ~/.alaude/            — v0.7.59-era move for memory + sessions.
 *                              Held: memory.json, profile.json, sessions.json,
 *                                    skills.json, skill-history.ndjson,
 *                                    permissions.json
 *     ~/Library/Application Support/alaude-desktop/  — Electron user data
 *
 *   v0.7.64 consolidates everything that used to live in ~/.claude/ or
 *   ~/.alaude/ into a single brand-consistent home: ~/.labaik/.
 *
 * MIGRATION
 *   We do NOT move or delete files from the legacy directories. The
 *   `resolveWithMigration()` helper reads from the new canonical path
 *   first; if missing, it copies from the first legacy location that
 *   has the file, then reads the new copy. Writes ALWAYS go to the
 *   new location.
 *
 *   This means:
 *     • Safe: legacy files stay as a backup indefinitely.
 *     • Transparent: the first read of each file silently migrates it.
 *     • Idempotent: re-running a migration that's already happened is a
 *       no-op (the new file already exists, the copy is skipped).
 *
 * API
 *   BASE_DIR              — ~/.labaik/
 *   CREDENTIALS_FILE      — ~/.labaik/credentials.json
 *   EVENTS_FILE           — ~/.labaik/events.ndjson
 *   OODA_STATE_FILE       — ~/.labaik/ooda-state.json
 *   UX_PROPOSALS_FILE     — ~/.labaik/ux-proposals.md
 *   SPACES_FILE           — ~/.labaik/spaces.json
 *   ensureBaseDir()       — mkdir -p ~/.labaik
 *   resolveWithMigration(canonical, legacyPaths)
 *                         — returns canonical, migrates from legacy
 *                           on first call if needed.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const HOME = os.homedir()
const BASE_DIR = path.join(HOME, '.labaik')

// Canonical (new) file locations.
const CREDENTIALS_FILE  = path.join(BASE_DIR, 'credentials.json')
const EVENTS_FILE       = path.join(BASE_DIR, 'events.ndjson')
const OODA_STATE_FILE   = path.join(BASE_DIR, 'ooda-state.json')
const UX_PROPOSALS_FILE = path.join(BASE_DIR, 'ux-proposals.md')
const SPACES_FILE       = path.join(BASE_DIR, 'spaces.json')

// Legacy locations we might need to read from on first boot.
const LEGACY_CLAUDE_DIR = path.join(HOME, '.claude')
const LEGACY_ALAUDE_DIR = path.join(HOME, '.alaude')

function ensureBaseDir() {
  try { fs.mkdirSync(BASE_DIR, { recursive: true, mode: 0o700 }) } catch {}
}

/**
 * Return the canonical path, copying from a legacy location on first
 * call if the canonical file is missing.
 *
 * @param {string}   canonical  — final location (inside ~/.labaik/)
 * @param {string[]} legacyPaths — ordered list of places to look for
 *                                 the file if canonical doesn't exist.
 *                                 First one that hits wins.
 * @returns {string} the canonical path (whether or not migration succeeded)
 */
function resolveWithMigration(canonical, legacyPaths) {
  try {
    ensureBaseDir()
    if (fs.existsSync(canonical)) return canonical
    for (const legacy of legacyPaths) {
      if (!legacy) continue
      if (!fs.existsSync(legacy)) continue
      try {
        fs.copyFileSync(legacy, canonical)
        console.log('[paths] migrated', legacy, '→', canonical)
        return canonical
      } catch (err) {
        console.warn('[paths] migration copy failed:', legacy, '→', canonical, err.message)
      }
    }
  } catch (err) {
    console.warn('[paths] resolve failed:', err.message)
  }
  return canonical
}

module.exports = {
  HOME,
  BASE_DIR,
  CREDENTIALS_FILE,
  EVENTS_FILE,
  OODA_STATE_FILE,
  UX_PROPOSALS_FILE,
  SPACES_FILE,
  LEGACY_CLAUDE_DIR,
  LEGACY_ALAUDE_DIR,
  ensureBaseDir,
  resolveWithMigration,
}
