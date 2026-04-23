// ad-hoc-sign.js — electron-builder `afterPack` hook.
//
// WHY THIS EXISTS
//   Shipping an unsigned macOS app used to work with a single Gatekeeper
//   warning ("unidentified developer, right-click → Open"). Since
//   macOS Catalina + arm64, fully-unsigned binaries are rejected with
//   the lying message "X is damaged and can't be opened. Move to
//   Trash." — which looks to end-users like the download is corrupt,
//   not like a signing issue they can work around.
//
//   An **ad-hoc signature** (`codesign --sign -`) is free, needs no
//   Apple Developer account, and gets us back to the old
//   "unidentified developer" flow: user right-clicks → Open → Open.
//   Still not great, but dramatically better than "damaged".
//
//   The proper fix is a Developer ID cert + notarization ($99/yr).
//   When that lands, this hook becomes dead code and should be
//   removed in favor of electron-builder's standard signing config.
//
// WHAT THIS DOES
//   After electron-builder packages the .app but before it builds the
//   DMG / zip, recursively ad-hoc sign every Mach-O inside (the main
//   app, Electron Helper variants, embedded frameworks). The
//   `--force --deep` flags make codesign clobber any partial/stale
//   signatures from the packager.

const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function adHocSign(context) {
  // Only sign macOS builds. Windows / Linux skip.
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log('[ad-hoc-sign] signing:', appPath)
  try {
    execFileSync('codesign', [
      '--force',           // overwrite any existing signature
      '--deep',            // recurse into nested bundles + frameworks
      '--sign', '-',       // ad-hoc identity (the literal dash)
      '--timestamp=none',  // don't try to reach Apple's timestamp server
      appPath,
    ], { stdio: 'inherit' })
    // Quick verify so the build fails loudly if something went wrong.
    execFileSync('codesign', ['--verify', '--verbose=1', appPath], { stdio: 'inherit' })
    console.log('[ad-hoc-sign] ok')
  } catch (err) {
    console.error('[ad-hoc-sign] FAILED:', err.message)
    throw err
  }
}
