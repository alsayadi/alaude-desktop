/**
 * Alaude permission classifier — pure module.
 *
 * No Electron / fs / net deps. Every export is a pure function so the
 * renderer, the main process, and the worker can share the same truth
 * about what's safe, what's dangerous, and what needs the user's
 * permission before running.
 *
 * See /Users/ahmed/.claude/plans/greedy-discovering-axolotl.md for the
 * design this implements.
 */

// ── Modes ───────────────────────────────────────────────────────────────
const MODES = ['observe', 'careful', 'flow', 'autopilot']
const MODE_META = {
  observe:  { icon: '👁️', label: 'Observe',  hint: 'Read-only research. No writes, no commands.' },
  careful:  { icon: '🛡️', label: 'Careful',  hint: 'Ask before every write and every command.' },
  flow:     { icon: '🌊', label: 'Flow',     hint: 'Auto-run safe edits and allow-listed commands. Always ask for dangerous ones.' },
  autopilot:{ icon: '🚀', label: 'Autopilot',hint: 'Run everything except protected paths and destructive commands. Previous Alaude behavior.' },
}
const MODE_ORDER = MODES
function nextMode(m) {
  const i = MODE_ORDER.indexOf(m)
  return MODE_ORDER[(i + 1) % MODE_ORDER.length]
}

// ── Protected paths ─────────────────────────────────────────────────────
// Every match → always prompt, regardless of mode. Users CANNOT allow-list
// these from the "Approve always" button — the UI disables that choice for
// protected paths so a distracted click can't overwrite shell rc files.
//
// Patterns are plain glob-style: `**` matches any depth, `*` matches any
// chunk of a single segment. All matching is case-insensitive for the
// filename portion (Linux is technically case-sensitive but users don't
// think that way).
const PROTECTED_GLOBS = [
  // Version control
  '.git/**', '.gitignore', '.gitmodules', '.github/workflows/**',
  // Secrets & dotenvs
  '.env', '.env.*', '*.env',
  '.ssh/**', 'id_rsa*', 'id_ed25519*', 'authorized_keys', 'known_hosts',
  '*.pem', '*.key', '*.p12', '*.pfx', '*.crt', '*.jks',
  // Tool configs that shouldn't be silently touched
  '.npmrc', '.pypirc', '.netrc',
  // Lockfiles — writes only (reads are fine); caller passes op='write'
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]
// Paths that are protected absolutely (match the beginning of a resolved
// absolute path, not a workspace-relative glob).
const PROTECTED_ABSOLUTE_PREFIXES = [
  '/etc/', '/usr/', '/System/', '/Library/LaunchAgents/', '/Library/LaunchDaemons/',
  '/bin/', '/sbin/',
]
// Home-dir prefixes — resolved against `home`. Any path that falls inside
// one of these when user-home-expanded is protected regardless of workspace.
const PROTECTED_HOME_PREFIXES = [
  '.claude/', '.anthropic/', '.alaude/',
  '.ssh/',
  '.aws/', '.config/gcloud/', '.kube/', '.docker/config.json',
  '.npmrc', '.pypirc', '.netrc',
  '.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile',
]

function globToRegex(g) {
  // Conservative glob → regex. Supports `**` (any depth) and `*` (any chars
  // except /). Used for workspace-relative pattern matching.
  const esc = g.replace(/[.+^$|()]/g, '\\$&')
  const re = esc
    .replace(/\*\*/g, '⟦DOUBLE⟧')
    .replace(/\*/g, '[^/]*')
    .replace(/⟦DOUBLE⟧/g, '.*')
  return new RegExp('^' + re + '$', 'i')
}
const _globCache = new Map()
function matchesGlob(path, glob) {
  let re = _globCache.get(glob)
  if (!re) { re = globToRegex(glob); _globCache.set(glob, re) }
  return re.test(path)
}

/**
 * Check if a path (relative to workspace) is protected. For writes, lockfiles
 * also count. Pass the caller's homedir so `~/.ssh` style paths resolve.
 *
 * Returns { protected: boolean, reason: string | null, match: string | null }.
 */
function isProtectedPath({ path, workspaceRoot, home, op = 'write' }) {
  if (!path) return { protected: false, reason: null, match: null }
  const p = String(path)
  // Absolute system prefixes
  for (const pref of PROTECTED_ABSOLUTE_PREFIXES) {
    if (p.startsWith(pref)) return { protected: true, reason: 'system-path', match: pref }
  }
  // Home-dir prefixes
  if (home) {
    for (const rel of PROTECTED_HOME_PREFIXES) {
      const full = home.endsWith('/') ? home + rel : home + '/' + rel
      if (p === full || p.startsWith(full + (full.endsWith('/') ? '' : '/')) || p.startsWith(full)) {
        return { protected: true, reason: 'home-config', match: rel }
      }
    }
  }
  // Workspace-relative globs
  let rel = p
  if (workspaceRoot && p.startsWith(workspaceRoot)) {
    rel = p.slice(workspaceRoot.length).replace(/^\//, '')
  }
  for (const g of PROTECTED_GLOBS) {
    // Lockfiles only matter for writes (reading them is fine)
    if ((g === 'package-lock.json' || g === 'yarn.lock' || g === 'pnpm-lock.yaml') && op !== 'write') continue
    if (matchesGlob(rel, g) || matchesGlob(p, g)) {
      return { protected: true, reason: 'sensitive-file', match: g }
    }
  }
  return { protected: false, reason: null, match: null }
}

// ── Dangerous command classifier ─────────────────────────────────────────
// Tripping any of these → always prompt, even in Autopilot. The UI will
// NOT offer an "Approve always" button for these (same as protected paths).
const DANGEROUS_PATTERNS = [
  { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/,                 why: 'recursive force delete' },
  { re: /(^|\s)sudo\b|(^|\s)su\s/,                                                 why: 'privilege escalation' },
  { re: /\bchmod\s+-R\b|\bchown\b/,                                                why: 'broad permission change' },
  { re: /\bdd\s+if=|\bmkfs\b|\bfdisk\b|\bparted\b/,                                why: 'block device write' },
  { re: /\bkill(all)?\s+-9\b|\bpkill\b/,                                           why: 'force-kill processes' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|python3?|node|perl|ruby)\b/,        why: 'pipe to shell (curl|bash)' },
  { re: /\bgit\s+push\s+(--force|-f)\b/,                                           why: 'force push' },
  { re: /\bgit\s+reset\s+--hard\b/,                                                why: 'hard reset' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/,                                             why: 'force-clean untracked' },
  { re: /\b(npm|yarn|bun|pnpm)\s+publish\b/,                                       why: 'publish to registry' },
  { re: />\s*\/dev\/sd[a-z]/,                                                      why: 'raw write to disk' },
  { re: />>?\s*~\/\.(bashrc|zshrc|profile|bash_profile|zprofile)/,                 why: 'shell-init overwrite' },
  { re: />>?\s*\/etc\//,                                                           why: 'overwrite /etc' },
]

// Flow-mode auto-approve allowlist — a conservative set of "always safe"
// read-only / build / test commands. Unknown commands in Flow mode prompt.
const SAFE_COMMAND_ALLOWLIST = [
  /^(ls|pwd|cat|head|tail|grep|rg|find|echo|which|wc|sort|uniq|date|env|uname|whoami|hostname|true|false)(\s|$)/,
  /^(node|bun|deno|python3?|pip[0-9]?)\s+(-V|--version)/,
  /^(npm|yarn|pnpm|bun)\s+(run|test|install|ci|ls|outdated|view)\b/,
  /^git\s+(status|diff|log|branch|show|stash\s+list|remote|config\s+--get|blame)\b/,
  /^(make|cargo|go|mvn|gradle)\s+(run|test|build|check|fmt|vet|clippy|--version)/,
]

/**
 * Classify a shell command into one of:
 *  - 'dangerous' — always prompt, match.why describes the reason.
 *  - 'safe'      — allow-listed, may auto-run in Flow.
 *  - 'unknown'   — not matched either way; Flow prompts, Autopilot auto.
 */
function classifyCommand(command, { workspaceRoot = '', home = '' } = {}) {
  const cmd = String(command || '').trim()
  if (!cmd) return { class: 'unknown', match: null, why: null }

  // Dangerous first (cheapest wins)
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(cmd)) return { class: 'dangerous', match: p.re.source, why: p.why }
  }

  // Path-escape heuristic — absolute paths outside workspace/tmp. Ignore the
  // caller's tool binary (first token) which often resolves via PATH.
  const pathTokens = cmd.match(/(^|\s)(\/[^\s]+|~\/[^\s]+)/g) || []
  for (const raw of pathTokens) {
    const t = raw.trim()
    if (t.startsWith('/tmp/') || t.startsWith('/var/tmp/')) continue
    if (workspaceRoot && t.startsWith(workspaceRoot)) continue
    if (home && (t === '~' || t.startsWith('~/') || t.startsWith(home + '/') || t === home)) {
      // Allow references INTO the home dir only if not hitting a protected prefix.
      const suffix = t.startsWith('~/') ? t.slice(2) : t.slice(home.length + 1)
      const prot = PROTECTED_HOME_PREFIXES.some(pref => suffix === pref.replace(/\/$/, '') || suffix.startsWith(pref))
      if (prot) return { class: 'dangerous', match: 'home-protected-path', why: 'touches protected home-dir file' }
      continue
    }
    // Absolute path pointing outside workspace/tmp/home — treat as path-escape.
    return { class: 'dangerous', match: 'out-of-workspace-path', why: 'references absolute path outside workspace' }
  }

  for (const re of SAFE_COMMAND_ALLOWLIST) {
    if (re.test(cmd)) return { class: 'safe', match: re.source, why: 'allow-listed safe command' }
  }
  return { class: 'unknown', match: null, why: null }
}

// ── Rule resolution ──────────────────────────────────────────────────────
/**
 * Given a tool invocation and the current mode + rule set, decide whether
 * the tool should: 'allow' (run silently), 'prompt' (ask the user), or
 * 'deny' (return an error without running).
 *
 * rules schema (from ~/.alaude/permissions.json):
 *   { defaultMode, workspaces: { [path]: { mode, allow: [{tool,pattern}], deny: [{tool,pattern}] } },
 *     global: { deny: [...] } }
 *
 * Priority (highest first):
 *   1. Observe mode: block everything except reads
 *   2. Global / workspace deny rules
 *   3. Protected-path check
 *   4. Dangerous-command check
 *   5. Workspace allow rules (match → allow)
 *   6. Mode default
 */
function resolveGate({ tool, args, mode, workspaceRoot, home, rules = {} }) {
  const toolName = tool
  const op = toolName === 'read_file' || toolName === 'list_directory' ? 'read'
           : toolName === 'write_file' ? 'write'
           : toolName === 'run_command' || toolName === 'start_dev_server' ? 'exec'
           : toolName === 'open_in_browser' ? 'open'
           : 'other'

  // (1) Observe mode
  if (mode === 'observe') {
    if (op === 'read') return { verdict: 'allow', reason: 'observe-read-ok' }
    return { verdict: 'deny', reason: 'observe-mode', message: 'Observe mode is read-only. Switch to Careful, Flow, or Autopilot in the composer to enable writes and commands.' }
  }

  // (2) Deny rules (global first, then workspace)
  const wsRules = rules?.workspaces?.[workspaceRoot] || {}
  const denyRules = [
    ...(rules?.global?.deny || []),
    ...(wsRules?.deny || []),
  ]
  for (const r of denyRules) {
    if (r.tool !== '*' && r.tool !== toolName) continue
    if (!r.pattern || _matchesRulePattern(args, r.pattern, toolName)) {
      return { verdict: 'deny', reason: 'user-deny-rule', message: `Blocked by your deny rule: ${r.pattern}` }
    }
  }

  // (3) Protected-path check (writes + reads of sensitive files)
  if (op === 'read' || op === 'write') {
    const p = isProtectedPath({ path: args?.path, workspaceRoot, home, op })
    if (p.protected) {
      return { verdict: 'prompt', reason: 'protected-path', floor: true, detail: p }
    }
  }
  if (op === 'exec') {
    // Does the command reference a protected path through the shell?
    const cls = classifyCommand(args?.command || '', { workspaceRoot, home })
    if (cls.class === 'dangerous') {
      return { verdict: 'prompt', reason: 'dangerous-command', floor: true, detail: cls }
    }
  }

  // (5) Workspace allow rules (applies only to non-floor situations)
  for (const r of (wsRules?.allow || [])) {
    if (r.tool !== '*' && r.tool !== toolName) continue
    if (_matchesRulePattern(args, r.pattern, toolName)) {
      return { verdict: 'allow', reason: 'user-allow-rule' }
    }
  }

  // (6) Mode default
  switch (mode) {
    case 'careful':
      if (op === 'read') return { verdict: 'allow', reason: 'careful-read-ok' }
      return { verdict: 'prompt', reason: 'careful-default' }
    case 'flow':
      if (op === 'read') return { verdict: 'allow', reason: 'flow-read-ok' }
      if (op === 'write') return { verdict: 'allow', reason: 'flow-write-ok' }
      if (op === 'exec') {
        const cls = classifyCommand(args?.command || '', { workspaceRoot, home })
        if (cls.class === 'safe') return { verdict: 'allow', reason: 'flow-cmd-safe', detail: cls }
        return { verdict: 'prompt', reason: 'flow-cmd-unknown', detail: cls }
      }
      if (op === 'open') {
        const url = String(args?.url || '')
        if (/^https?:\/\//i.test(url) || url.startsWith('localhost') || (!url.startsWith('/') && !url.startsWith('~'))) {
          return { verdict: 'allow', reason: 'flow-open-ok' }
        }
        return { verdict: 'prompt', reason: 'flow-open-unknown' }
      }
      return { verdict: 'allow', reason: 'flow-other' }
    case 'autopilot':
    default:
      return { verdict: 'allow', reason: 'autopilot' }
  }
}

function _matchesRulePattern(args, pattern, toolName) {
  try {
    const re = new RegExp(pattern)
    if (toolName === 'run_command' || toolName === 'start_dev_server') return re.test(args?.command || '')
    if (toolName === 'write_file' || toolName === 'read_file' || toolName === 'list_directory') return re.test(args?.path || '')
    if (toolName === 'open_in_browser') return re.test(args?.url || '')
    return false
  } catch { return false }
}

module.exports = {
  MODES,
  MODE_META,
  nextMode,
  isProtectedPath,
  classifyCommand,
  resolveGate,
  // Exported for tests / introspection
  PROTECTED_GLOBS,
  PROTECTED_ABSOLUTE_PREFIXES,
  PROTECTED_HOME_PREFIXES,
  DANGEROUS_PATTERNS,
  SAFE_COMMAND_ALLOWLIST,
}
