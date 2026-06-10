/**
 * Command scope boundary check — pure, dependency-light (path + os only),
 * so scripts/test-modules.mjs can exercise the exact logic the worker runs.
 *
 * Tools with cwd=workspacePath (run_command, start_dev_server) would be
 * trivially escaped by a command naming an absolute/home path or cd-ing out
 * of scope. This is a best-effort guard (the permission gate + OS are the
 * other layers): reject directory-change escapes and path mentions that
 * resolve outside the workspace, except read-only system dirs.
 */
const path = require('path')
const os = require('os')

function checkCommandScope(command, workspacePath) {
  if (!command || !workspacePath) return { ok: true }
  const root = path.resolve(workspacePath)
  const home = os.homedir()
  // 1. Directory-change escapes. v0.8 cycle 46: also catch `cd ~`, `cd`
  //    (bare → home), `cd $HOME`, and `pushd` — previously only `cd ..` /
  //    `cd /` were caught, so `cd ~ && cat secret` walked right out.
  if (/\b(?:cd|pushd)\s+(?:\.\.(?:\/|$|\s)|\/|~|\$\{?HOME\}?)/i.test(command) ||
      /\bcd\s*(?:;|&&|\||$)/i.test(command)) {
    return { ok: false, reason: 'directory-change attempts to escape the workspace scope' }
  }
  // 2. Path mentions outside scope. Covers absolute (/…), home (~/…), and
  //    $HOME/… forms — the last two were a hole (e.g. `cat ~/.ssh/id_rsa`).
  const systemDirs = ['/tmp', '/usr', '/etc', '/var', '/bin', '/sbin', '/opt', '/Library', '/System', '/dev', '/private']
  const tokenRe = /(?:^|[\s'"`;|&()<>])((?:\/|~\/|~$|\$\{?HOME\}?\/)(?:[^\s'"`;|&()<>]|\\ )*)/g
  for (const m of [...command.matchAll(tokenRe)]) {
    let p = m[1]
    if (p.match(/^\/\w+:\/\//)) continue                     // URL fragment
    const isHome = p === '~' || p.startsWith('~/') || /^\$\{?HOME\}?\//.test(p)
    if (!isHome && systemDirs.some(d => p === d || p.startsWith(d + '/'))) continue
    // Expand home forms before resolving.
    const expanded = isHome ? p.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?/, home) : p
    let resolved
    try { resolved = path.resolve(expanded) } catch { continue }
    if (resolved === root || resolved.startsWith(root + path.sep)) continue
    return { ok: false, reason: `path ${p} is outside ${workspacePath}` }
  }
  return { ok: true }
}


module.exports = { checkCommandScope }
