// scripts/ad-hoc-sign.js — electron-builder `afterPack` hook.
//
// DUAL-MODE SIGNING
//   1. **Developer ID present** (prod) — skip this hook entirely and
//      let electron-builder run its normal codesign path using the
//      Developer ID cert + entitlements + hardened runtime. That path
//      is triggered when package.json's `mac.identity` is NOT null.
//   2. **No Developer ID** (dev) — fall through to ad-hoc signing here
//      so local builds still produce an openable .app (via right-click
//      → Open on older macOS). Ad-hoc won't pass Gatekeeper on
//      Sequoia+ but is useful for quick local testing.
//
// HOW THIS FILE GETS BYPASSED IN PROD
//   package.json's `mac.identity` starts as null (forcing ad-hoc path).
//   When a Developer ID cert is installed in Keychain and we want to
//   produce a notarizable build, package.json sets identity to
//   "Developer ID Application: <name> (<teamid>)" and electron-builder
//   handles signing natively. This script still runs, but we detect
//   that a real signature is already in place and no-op.

const { execFileSync } = require('child_process')
const path = require('path')

function isDeveloperIDSigned(appPath) {
  try {
    const out = execFileSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // electron-builder already signed with Developer ID → 'Authority=Developer ID Application' appears.
    return /Authority=Developer ID Application/.test(out)
  } catch {
    return false
  }
}

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // Respect existing Developer ID signing — don't overwrite Apple-trusted
  // signatures with ad-hoc ones. This keeps the hook safe to leave on
  // in prod builds.
  if (isDeveloperIDSigned(appPath)) {
    console.log('[sign] Developer ID signature already in place — skipping ad-hoc.')
    return
  }

  console.log('[sign] ad-hoc signing:', appPath)
  try {
    execFileSync('codesign', [
      '--force',           // overwrite any existing signature
      '--deep',            // recurse into nested bundles + frameworks
      '--sign', '-',       // ad-hoc identity
      '--timestamp=none',
      appPath,
    ], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--verbose=1', appPath], { stdio: 'inherit' })
    console.log('[sign] ad-hoc ok')
  } catch (err) {
    console.error('[sign] FAILED:', err.message)
    throw err
  }
}
