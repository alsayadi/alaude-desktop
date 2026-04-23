// scripts/notarize.js — electron-builder `afterSign` hook.
//
// Runs AFTER electron-builder signs the .app with Developer ID but
// BEFORE it packs the DMG. Submits the signed .app to Apple's
// notarization service, waits for the verdict, then staples the
// notarization ticket to the .app so Gatekeeper can verify it offline.
//
// Prerequisites (set up once, outside this script):
//   1. Apple Developer Program membership, License Agreement signed.
//   2. "Developer ID Application" cert installed in keychain.
//   3. App-specific password stored in keychain under the profile
//      name "alaude-notarize":
//        xcrun notarytool store-credentials alaude-notarize \
//          --apple-id <email> --team-id <teamid> --password <app-pw>
//
// If any of those is missing, this hook NO-OPS gracefully — the build
// produces a signed-but-not-notarized .app that still opens on the
// developer's machine (since it's signed with their own cert) but
// will be rejected by Gatekeeper on other machines.
//
// Behavior knobs via env vars:
//   ALAUDE_SKIP_NOTARIZE=1 — skip notarization explicitly (fast dev loop)
//   ALAUDE_NOTARIZE_PROFILE=<name> — override keychain profile name
//     (defaults to "alaude-notarize")

const { execFileSync, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const PROFILE_NAME = process.env.ALAUDE_NOTARIZE_PROFILE || 'alaude-notarize'
const POLL_INTERVAL_MS = 30_000   // 30s between status polls
const POLL_TIMEOUT_MS = 20 * 60 * 1000  // give up after 20 min

// Poll submission status with retries on transient TLS/network errors.
// Returns final status string ('Accepted' | 'Invalid' | 'Rejected' | 'Timeout').
function waitForSubmission(submissionId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let consecutiveErrors = 0
  while (Date.now() < deadline) {
    const r = spawnSync('xcrun', ['notarytool', 'info', submissionId, '--keychain-profile', PROFILE_NAME], {
      encoding: 'utf8',
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const statusMatch = out.match(/status:\s*(\w+)/)
    if (statusMatch) {
      consecutiveErrors = 0
      const status = statusMatch[1]
      console.log('[notarize] status:', status)
      if (status === 'In Progress') {
        // still going — wait and try again
      } else {
        // Accepted / Invalid / Rejected — terminal
        return status
      }
    } else {
      // Transient error (TLS etc). Tolerate up to a few in a row.
      consecutiveErrors++
      console.warn('[notarize] status probe failed (attempt ' + consecutiveErrors + '):', out.trim().slice(0, 200))
      if (consecutiveErrors >= 5) return 'Timeout'  // 5 × 30s = too many failures
    }
    // Busy-wait with sleep. Can't use setTimeout in sync build hook.
    const waitUntil = Date.now() + POLL_INTERVAL_MS
    while (Date.now() < waitUntil) {
      spawnSync('sleep', ['1'])
    }
  }
  return 'Timeout'
}

function hasStoredCredentials() {
  // notarytool doesn't expose a dedicated "does this profile exist" command.
  // `notarytool history --keychain-profile <name>` fails fast if the
  // profile isn't in keychain, so we use that as a probe.
  try {
    execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE_NAME], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

function isDeveloperIDSigned(appPath) {
  try {
    // codesign writes all its metadata to STDERR, not STDOUT (a long-standing
    // quirk of the tool). Use spawnSync so we can read stderr explicitly.
    const { spawnSync } = require('child_process')
    const r = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' })
    const combined = (r.stdout || '') + (r.stderr || '')
    return /Authority=Developer ID Application/.test(combined)
  } catch {
    return false
  }
}

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.ALAUDE_SKIP_NOTARIZE === '1') {
    console.log('[notarize] ALAUDE_SKIP_NOTARIZE=1 — skipping.')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  // Pre-flight: skip if the app isn't Developer-ID signed. Apple rejects
  // ad-hoc signed submissions anyway, so calling notarytool would just
  // waste time.
  if (!isDeveloperIDSigned(appPath)) {
    console.log('[notarize] No Developer ID signature found on', appPath)
    console.log('[notarize] Skipping notarization — install a Dev ID cert to enable.')
    return
  }

  if (!hasStoredCredentials()) {
    console.warn(`[notarize] No keychain profile named "${PROFILE_NAME}".`)
    console.warn('[notarize] Run: xcrun notarytool store-credentials ' + PROFILE_NAME)
    console.warn('[notarize] Skipping — binary will be signed but not notarized.')
    return
  }

  // notarytool requires a zip (or DMG/pkg) to submit — not a raw .app.
  // We make a throwaway zip next to the .app, submit, then delete.
  const zipPath = path.join(context.appOutDir, `${appName}-notarize.zip`)
  console.log('[notarize] Creating submission zip:', zipPath)
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' })

  try {
    console.log('[notarize] Submitting to Apple (this takes 1-5 min)…')
    // Submit WITHOUT --wait so a transient TLS hiccup during polling
    // doesn't crash the whole build. We poll manually below with
    // retry-on-network-error logic.
    const submitResult = spawnSync('xcrun', [
      'notarytool', 'submit', zipPath,
      '--keychain-profile', PROFILE_NAME,
      '--no-wait',
    ], { encoding: 'utf8' })
    const submitOutput = (submitResult.stdout || '') + (submitResult.stderr || '')
    process.stdout.write(submitOutput)
    if (submitResult.status !== 0) throw new Error('notarytool submit failed')

    const idMatch = submitOutput.match(/id:\s*([a-f0-9-]+)/i)
    if (!idMatch) throw new Error('could not parse submission id from notarytool output')
    const submissionId = idMatch[1]
    console.log('[notarize] Submission id:', submissionId, '— polling for completion…')

    const finalStatus = waitForSubmission(submissionId)
    if (finalStatus !== 'Accepted') {
      console.error('[notarize] Apple rejected or timed out:', finalStatus)
      // Try to fetch the log for diagnostics.
      const logResult = spawnSync('xcrun', ['notarytool', 'log', submissionId, '--keychain-profile', PROFILE_NAME], { encoding: 'utf8' })
      console.error(logResult.stdout || logResult.stderr)
      throw new Error('notarization not accepted: ' + finalStatus)
    }

    console.log('[notarize] Accepted. Stapling ticket to', appPath)
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' })
    console.log('[notarize] ✓ notarized and stapled')
  } finally {
    try { fs.unlinkSync(zipPath) } catch {}
  }
}
