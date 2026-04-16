/**
 * OODA loop — UX self-tuning microscope for Alaude (local/dev only).
 *
 * Observe: append every interaction event to ~/.claude/alaude-events.ndjson.
 * Orient:  every MIN_BATCH_SIZE outcomes, group by dimension and compute stats.
 * Decide:  priority-ordered rules return ONE proposal per batch.
 * Act:     proposal is written to ~/.claude/alaude-ux-proposals.md — a human
 *          reviews before applying. Iron law: no auto-mutation of UX copy.
 *
 * State survives restarts via JSON file at ~/.claude/alaude-ooda-state.json.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const DIR = path.join(os.homedir(), '.claude')
const EVENTS_FILE = path.join(DIR, 'alaude-events.ndjson')
const STATE_FILE = path.join(DIR, 'alaude-ooda-state.json')
const PROPOSALS_FILE = path.join(DIR, 'alaude-ux-proposals.md')

// Solo-user dev instrumentation — small batch size is fine. Canonical rec is
// ≥30 but for a single user 10 gives a usable first diagnosis in one session.
const MIN_BATCH_SIZE = 10

// Correlation windows for deriving outcome signals from event sequences.
const RETRY_WINDOW_MS = 60_000      // same prompt within 60s → retry signal
const ABANDON_WINDOW_MS = 30_000    // no further activity in 30s → abandoned

// ─────────────────────────────────────────────────────────────────────────────
// Observe — raw event log (append-only NDJSON)
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }) } catch {}
}

/**
 * Append a raw event. Best effort; never throws into the caller.
 * Event shape example:
 *   { kind: 'chat_send', sessionId, messageId, space, provider, model,
 *     entry, hasWorkspace, hasAttachments, promptHash, promptLen }
 *   { kind: 'chat_complete', sessionId, messageId, success, latencyMs,
 *     errorType?, responseLen? }
 *   { kind: 'response_copied', sessionId, messageId }
 *   { kind: 'retry_detected', sessionId, prevMessageId, promptHash }
 *   { kind: 'session_end', sessionId, messagesCount }
 *   { kind: 'model_switched', sessionId, fromModel, toModel }
 */
function logEvent(event) {
  try {
    ensureDir()
    const e = { ts: new Date().toISOString(), ...event }
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(e) + '\n')
  } catch (err) {
    // Never let telemetry break the app
    process.stderr.write(`[ooda] logEvent failed: ${err.message}\n`)
  }
}

function readEvents(sinceIso) {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return []
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8')
    const out = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (!sinceIso || e.ts > sinceIso) out.push(e)
      } catch {}
    }
    return out
  } catch (err) {
    process.stderr.write(`[ooda] readEvents failed: ${err.message}\n`)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { lastBatchAt: null, batchCount: 0, appliedChanges: [] }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { lastBatchAt: null, batchCount: 0, appliedChanges: [] }
  }
}

function saveState(state) {
  try {
    ensureDir()
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    process.stderr.write(`[ooda] saveState failed: ${err.message}\n`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event → Outcome aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pair chat_send + chat_complete events into outcomes, then attach signals
 * from nearby events (retry, copy, abandonment) and compute the composite
 * health score.
 *
 * Score:
 *   +1 clean success
 *   -1 error
 *   -2 retry-same-prompt (answer wasn't useful)
 *   -1 abandoned within 30s (user gave up)
 *   +1 response copied (clear positive signal)
 * Range: roughly −3 to +2.
 */
function buildOutcomes(events) {
  const byMsg = new Map() // messageId → { send, complete }
  const copies = new Map() // messageId → ts
  const retries = new Map() // prevMessageId → retry event
  const endedAt = new Map() // sessionId → session_end event ts
  const bySession = new Map() // sessionId → [events sorted by ts]

  for (const e of events) {
    if (e.kind === 'chat_send') {
      const cur = byMsg.get(e.messageId) || {}
      cur.send = e
      byMsg.set(e.messageId, cur)
    } else if (e.kind === 'chat_complete') {
      const cur = byMsg.get(e.messageId) || {}
      cur.complete = e
      byMsg.set(e.messageId, cur)
    } else if (e.kind === 'response_copied') {
      copies.set(e.messageId, e.ts)
    } else if (e.kind === 'retry_detected') {
      retries.set(e.prevMessageId, e)
    } else if (e.kind === 'session_end') {
      endedAt.set(e.sessionId, e.ts)
    }
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, [])
    bySession.get(e.sessionId).push(e)
  }

  // Pre-sort events in each session so we can find "next event after X" cheaply.
  for (const arr of bySession.values()) arr.sort((a, b) => a.ts.localeCompare(b.ts))

  const outcomes = []
  for (const [messageId, { send, complete }] of byMsg) {
    if (!send) continue
    const success = complete ? !!complete.success : false
    const errorType = complete?.errorType || (!complete ? 'no_complete' : null)
    const latencyMs = complete?.latencyMs || null
    const retriedSame = retries.has(messageId)
    const copied = copies.has(messageId)

    // Abandonment: no further meaningful activity in this session within
    // ABANDON_WINDOW_MS after the completion timestamp. A session_end event
    // inside the window does NOT count as abandonment — user ended cleanly.
    let abandoned = false
    if (complete) {
      const sessionEvents = bySession.get(send.sessionId) || []
      const completeMs = new Date(complete.ts).getTime()
      // Find the first event in this session whose ts is strictly after the
      // completion. Any kind of event (new send, copy, model switch) counts
      // as "user still active" — only session_end is excluded so a user
      // who ends cleanly doesn't get double-flagged.
      const nextActivity = sessionEvents.find(e =>
        e.ts > complete.ts && e.kind !== 'session_end' && e.messageId !== messageId
      )
      if (!nextActivity) {
        // No later activity at all → abandoned unless session was ended cleanly
        // within the window.
        const endTs = endedAt.get(send.sessionId)
        const endedCleanlyInWindow = endTs && (new Date(endTs).getTime() - completeMs) <= ABANDON_WINDOW_MS
        abandoned = !endedCleanlyInWindow
      } else {
        const gap = new Date(nextActivity.ts).getTime() - completeMs
        abandoned = gap > ABANDON_WINDOW_MS
      }
    }

    let value = 0
    if (success) value += 1
    else value -= 1
    if (retriedSame) value -= 2
    if (abandoned) value -= 1
    if (copied) value += 1

    outcomes.push({
      messageId,
      ts: send.ts,
      sessionId: send.sessionId,
      space: send.space || 'unknown',
      provider: send.provider || 'unknown',
      model: send.model || 'unknown',
      modelFamily: modelFamily(send.model),
      entry: send.entry || 'freeform',
      hasWorkspace: !!send.hasWorkspace,
      hasAttachments: !!send.hasAttachments,
      action: send.action || null, // quick-action id if entry=quickaction
      success,
      errorType,
      latencyMs,
      retriedSame,
      abandoned,
      copied,
      value,
    })
  }

  outcomes.sort((a, b) => a.ts.localeCompare(b.ts))
  return outcomes
}

function modelFamily(model) {
  if (!model) return 'unknown'
  const s = String(model).toLowerCase()
  if (s.startsWith('gpt-') || s.startsWith('o1') || s.startsWith('o3') || s.startsWith('o4')) return 'openai'
  if (s.startsWith('claude')) return 'claude'
  if (s.startsWith('gemini')) return 'gemini'
  if (s.startsWith('gemma')) return 'gemma'
  if (s.startsWith('qwen3')) return 'qwen3'
  if (s.startsWith('qwen')) return 'qwen'
  if (s.startsWith('llama')) return 'llama'
  if (s.startsWith('deepseek')) return 'deepseek'
  if (s.startsWith('grok')) return 'grok'
  if (s.startsWith('moonshot') || s.startsWith('kimi')) return 'moonshot'
  if (s.startsWith('glm')) return 'glm'
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// Orient — dimensional breakdown
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function statsFor(outcomes) {
  if (!outcomes.length) return null
  const n = outcomes.length
  const errors = outcomes.filter(o => !o.success).length
  const retries = outcomes.filter(o => o.retriedSame).length
  const abandons = outcomes.filter(o => o.abandoned).length
  const copies = outcomes.filter(o => o.copied).length
  const lats = outcomes.map(o => o.latencyMs).filter(v => typeof v === 'number').sort((a, b) => a - b)
  const totalValue = outcomes.reduce((s, o) => s + o.value, 0)
  return {
    n,
    errorRate: errors / n,
    retryRate: retries / n,
    abandonRate: abandons / n,
    copyRate: copies / n,
    latencyP50: percentile(lats, 50),
    latencyP95: percentile(lats, 95),
    meanValue: totalValue / n,
    totalValue,
    topErrorType: topOf(outcomes.filter(o => o.errorType).map(o => o.errorType)),
  }
}

function topOf(arr) {
  if (!arr.length) return null
  const counts = new Map()
  for (const x of arr) counts.set(x, (counts.get(x) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function groupBy(outcomes, key) {
  const buckets = new Map()
  for (const o of outcomes) {
    const k = o[key] ?? '∅'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(o)
  }
  const out = {}
  for (const [k, arr] of buckets) out[k] = statsFor(arr)
  return out
}

/** Group by a composite key (e.g. space × model) — produces "space/model" labels. */
function groupByPair(outcomes, k1, k2) {
  const buckets = new Map()
  for (const o of outcomes) {
    const key = `${o[k1]}/${o[k2]}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(o)
  }
  const out = {}
  for (const [k, arr] of buckets) out[k] = statsFor(arr)
  return out
}

function orient(outcomes) {
  return {
    overall: statsFor(outcomes),
    bySpace: groupBy(outcomes, 'space'),
    byProvider: groupBy(outcomes, 'provider'),
    byModelFamily: groupBy(outcomes, 'modelFamily'),
    byEntry: groupBy(outcomes, 'entry'),
    byQuickAction: groupBy(outcomes.filter(o => o.action), 'action'),
    bySpaceModel: groupByPair(outcomes, 'space', 'modelFamily'),
    byErrorType: groupBy(outcomes.filter(o => o.errorType), 'errorType'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decide — priority-ordered diagnosis. First match wins. One change per batch.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_BUCKET_N = 5 // ignore buckets smaller than this — noise

function diagnose(orientation) {
  const o = orientation

  // Rule 1: High error rate on a provider
  const worstProvider = worstBucketBy(o.byProvider, 'errorRate', MIN_BUCKET_N)
  if (worstProvider && worstProvider.stats.errorRate > 0.25) {
    return {
      priority: 1,
      problem: `Provider "${worstProvider.key}" has ${(worstProvider.stats.errorRate * 100).toFixed(0)}% error rate (${Math.round(worstProvider.stats.errorRate * worstProvider.stats.n)}/${worstProvider.stats.n}) — top error: ${worstProvider.stats.topErrorType || 'unknown'}`,
      suggestion: `Investigate "${worstProvider.stats.topErrorType || 'unknown'}" errors on ${worstProvider.key}. If network-related, raise timeout; if model-quality-related, swap default model.`,
      param: `providers[${worstProvider.key}].timeout`,
      bucket: worstProvider.key,
      dimension: 'provider',
    }
  }

  // Rule 2: High retry rate on a space×model pair
  const worstSpaceModel = worstBucketBy(o.bySpaceModel, 'retryRate', MIN_BUCKET_N)
  if (worstSpaceModel && worstSpaceModel.stats.retryRate > 0.20) {
    return {
      priority: 2,
      problem: `Space/model "${worstSpaceModel.key}" has ${(worstSpaceModel.stats.retryRate * 100).toFixed(0)}% retry rate — answers aren't landing`,
      suggestion: `Swap the default model for this space, or refine the space system prompt. Also review recent prompts here.`,
      param: `spaces[${worstSpaceModel.key.split('/')[0]}].defaultModel`,
      bucket: worstSpaceModel.key,
      dimension: 'space×model',
    }
  }

  // Rule 3: Quick-action abandonment
  const worstAction = worstBucketBy(o.byQuickAction, 'abandonRate', MIN_BUCKET_N)
  if (worstAction && worstAction.stats.abandonRate > 0.40) {
    return {
      priority: 3,
      problem: `Quick-action "${worstAction.key}" abandoned ${(worstAction.stats.abandonRate * 100).toFixed(0)}% of the time`,
      suggestion: `Rewrite the prompt template for this quick-action — the resulting answers don't engage users.`,
      param: `quickActions[${worstAction.key}].prompt`,
      bucket: worstAction.key,
      dimension: 'quickAction',
    }
  }

  // Rule 4: Provider latency outlier
  const slowest = worstBucketBy(o.byProvider, 'latencyP95', MIN_BUCKET_N, true)
  if (slowest && slowest.stats.latencyP95 && slowest.stats.latencyP95 > 30_000) {
    return {
      priority: 4,
      problem: `Provider "${slowest.key}" p95 latency is ${(slowest.stats.latencyP95 / 1000).toFixed(1)}s`,
      suggestion: `Consider raising timeout, picking a smaller/faster default model, or showing a progress hint after 5s.`,
      param: `providers[${slowest.key}].timeout`,
      bucket: slowest.key,
      dimension: 'provider',
    }
  }

  // Rule 5: Underused quick-action (catalog bloat)
  const sendCount = o.overall?.n || 1
  const actions = Object.entries(o.byQuickAction || {})
  if (actions.length) {
    const smallest = actions.sort((a, b) => a[1].n - b[1].n)[0]
    const share = smallest[1].n / sendCount
    if (share < 0.03 && sendCount >= 30) {
      return {
        priority: 5,
        problem: `Quick-action "${smallest[0]}" used in only ${smallest[1].n}/${sendCount} messages (${(share * 100).toFixed(1)}%)`,
        suggestion: `Demote or remove to reduce UI clutter.`,
        param: `quickActions[${smallest[0]}].hidden`,
        bucket: smallest[0],
        dimension: 'quickAction',
      }
    }
  }

  // Rule 6: Healthy (no change)
  if (o.overall && o.overall.meanValue > 0) {
    return {
      priority: 99,
      problem: 'No significant issues detected',
      suggestion: 'Ship as-is. Re-evaluate after the next batch.',
      param: null,
      bucket: null,
      dimension: 'overall',
    }
  }

  return {
    priority: 6,
    problem: `Mean outcome value is ${o.overall?.meanValue?.toFixed(2) || 'n/a'} — marginally negative, no dominant failure mode`,
    suggestion: 'Collect more data; if trend persists, review recent sessions manually.',
    param: null,
    bucket: null,
    dimension: 'overall',
  }
}

/**
 * Find the bucket with the worst value of `metric` (highest, unless
 * `reverse=false`). Bucket must have ≥ minN outcomes.
 */
function worstBucketBy(buckets, metric, minN, higherIsWorse = true) {
  const entries = Object.entries(buckets || {}).filter(([_, s]) => s && s.n >= minN && s[metric] != null)
  if (!entries.length) return null
  const sorted = entries.sort((a, b) => higherIsWorse ? b[1][metric] - a[1][metric] : a[1][metric] - b[1][metric])
  return { key: sorted[0][0], stats: sorted[0][1] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Act — write proposal to markdown, log to state
// ─────────────────────────────────────────────────────────────────────────────

function writeProposal(diagnosis, orientation, batchMeta) {
  try {
    ensureDir()
    const now = new Date().toISOString()
    const md = [
      `## Batch #${batchMeta.batchId} · ${now}`,
      '',
      `**Size:** ${batchMeta.size} outcomes · **Range:** ${batchMeta.firstTs} → ${batchMeta.lastTs}`,
      '',
      `**Overall:** mean value **${orientation.overall.meanValue.toFixed(2)}**, error ${(orientation.overall.errorRate * 100).toFixed(0)}%, retry ${(orientation.overall.retryRate * 100).toFixed(0)}%, abandon ${(orientation.overall.abandonRate * 100).toFixed(0)}%, copy ${(orientation.overall.copyRate * 100).toFixed(0)}%`,
      '',
      `### Diagnosis (priority ${diagnosis.priority})`,
      '',
      `- **Problem:** ${diagnosis.problem}`,
      `- **Suggestion:** ${diagnosis.suggestion}`,
      `- **Parameter:** \`${diagnosis.param || '—'}\``,
      '',
      `### Dimension breakdown`,
      '',
      renderBreakdownTable(orientation),
      '',
      '---',
      '',
    ].join('\n')
    // Prepend so newest batch is at the top
    const existing = fs.existsSync(PROPOSALS_FILE) ? fs.readFileSync(PROPOSALS_FILE, 'utf8') : '# Alaude UX Proposals\n\nReviewed manually — never auto-applied.\n\n---\n\n'
    const [header, ...rest] = existing.split('---\n\n')
    const body = rest.join('---\n\n')
    fs.writeFileSync(PROPOSALS_FILE, header + '---\n\n' + md + body)
  } catch (err) {
    process.stderr.write(`[ooda] writeProposal failed: ${err.message}\n`)
  }
}

function renderBreakdownTable(o) {
  const rows = []
  rows.push('| Dim | Bucket | n | err% | retry% | abandon% | p95 |')
  rows.push('|---|---|--:|--:|--:|--:|--:|')
  const pushBucket = (dim, key, s) => {
    rows.push(`| ${dim} | ${key} | ${s.n} | ${(s.errorRate * 100).toFixed(0)} | ${(s.retryRate * 100).toFixed(0)} | ${(s.abandonRate * 100).toFixed(0)} | ${s.latencyP95 != null ? (s.latencyP95 / 1000).toFixed(1) + 's' : '—'} |`)
  }
  for (const [k, s] of Object.entries(o.byProvider || {})) pushBucket('provider', k, s)
  for (const [k, s] of Object.entries(o.bySpace || {})) pushBucket('space', k, s)
  for (const [k, s] of Object.entries(o.byEntry || {})) pushBucket('entry', k, s)
  return rows.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — called after every finalized chat
// ─────────────────────────────────────────────────────────────────────────────

function maybeRunBatch({ force = false } = {}) {
  try {
    const state = loadState()
    const allEvents = readEvents()
    const allOutcomes = buildOutcomes(allEvents)
    const newOutcomes = state.lastBatchAt
      ? allOutcomes.filter(o => o.ts > state.lastBatchAt)
      : allOutcomes

    if (!force && newOutcomes.length < MIN_BATCH_SIZE) {
      return { ran: false, newCount: newOutcomes.length, needed: MIN_BATCH_SIZE }
    }
    if (newOutcomes.length === 0) return { ran: false, newCount: 0, needed: MIN_BATCH_SIZE }

    const orientation = orient(newOutcomes)
    const diagnosis = diagnose(orientation)
    const batchId = (state.batchCount || 0) + 1
    const batchMeta = {
      batchId,
      size: newOutcomes.length,
      firstTs: newOutcomes[0].ts,
      lastTs: newOutcomes[newOutcomes.length - 1].ts,
    }

    writeProposal(diagnosis, orientation, batchMeta)

    state.lastBatchAt = batchMeta.lastTs
    state.batchCount = batchId
    state.appliedChanges = state.appliedChanges || []
    state.appliedChanges.push({
      ts: new Date().toISOString(),
      batchId,
      diagnosis: { ...diagnosis },
      applied: false, // always false — we don't auto-apply
    })
    // Keep only the last 50 change entries
    state.appliedChanges = state.appliedChanges.slice(-50)
    saveState(state)

    return { ran: true, batchId, diagnosis, orientation, batchMeta }
  } catch (err) {
    process.stderr.write(`[ooda] maybeRunBatch failed: ${err.stack || err.message}\n`)
    return { ran: false, error: err.message }
  }
}

/** Latest batch summary for the in-app dashboard. */
function getLatestSummary() {
  try {
    const state = loadState()
    const allEvents = readEvents()
    const allOutcomes = buildOutcomes(allEvents)
    const recentOutcomes = allOutcomes.slice(-MIN_BATCH_SIZE * 3)
    const orientation = allOutcomes.length ? orient(recentOutcomes) : null

    const newCount = state.lastBatchAt ? allOutcomes.filter(o => o.ts > state.lastBatchAt).length : allOutcomes.length
    const lastDiagnosis = (state.appliedChanges || []).slice(-1)[0] || null

    return {
      totalOutcomes: allOutcomes.length,
      totalEvents: allEvents.length,
      batchCount: state.batchCount || 0,
      lastBatchAt: state.lastBatchAt,
      newSinceLastBatch: newCount,
      minBatchSize: MIN_BATCH_SIZE,
      recentStats: orientation?.overall || null,
      recentOrientation: orientation,
      lastDiagnosis,
      changeHistory: (state.appliedChanges || []).slice(-10).reverse(),
      proposalsFile: PROPOSALS_FILE,
    }
  } catch (err) {
    return { error: err.message }
  }
}

module.exports = {
  logEvent,
  maybeRunBatch,
  getLatestSummary,
  // exposed for testing / ad-hoc analysis
  readEvents,
  buildOutcomes,
  orient,
  diagnose,
  EVENTS_FILE,
  STATE_FILE,
  PROPOSALS_FILE,
  MIN_BATCH_SIZE,
}
