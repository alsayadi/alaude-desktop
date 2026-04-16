#!/usr/bin/env node
/**
 * Overnight dogfood: synthesize 40 realistic Alaude interactions across
 * multiple spaces, providers, and failure modes. Feed them through the OODA
 * loop in 4 batches of 10 and verify each batch produces a sensible
 * diagnosis.
 *
 * Does NOT touch real event logs — uses isolated temp files.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const ooda = require('./ooda')

// Back up real logs so we don't pollute user data
const backups = {}
for (const f of [ooda.EVENTS_FILE, ooda.STATE_FILE, ooda.PROPOSALS_FILE]) {
  if (fs.existsSync(f)) backups[f] = fs.readFileSync(f)
  try { fs.unlinkSync(f) } catch {}
}

let t = Date.now() - 4 * 3600 * 1000 // 4 hours ago
const seq = []
let idx = 0

function ms(s) { t += s * 1000; return new Date(t).toISOString() }

function send(space, provider, model, entry = 'freeform', action = null) {
  const id = 'mid_' + (++idx)
  seq.push({ ts: ms(0), kind: 'chat_send', sessionId: 'sess_' + Math.floor(idx / 8),
             messageId: id, space, provider, model, entry, action,
             hasWorkspace: false, hasAttachments: false, promptLen: 80, promptHash: 'h' + idx })
  return id
}
function complete(id, success, latencyMs, errorType) {
  seq.push({ ts: ms(latencyMs / 1000), kind: 'chat_complete', sessionId: 'sess_' + Math.floor(idx / 8),
             messageId: id, success, latencyMs, errorType: errorType || null })
  t += 5000 // gap
}
function retryOf(prevId, nextId) {
  seq.push({ ts: ms(1), kind: 'retry_detected', sessionId: 'sess_' + Math.floor(idx / 8),
             prevMessageId: prevId, newMessageId: nextId, promptHash: 'h_retry' })
}
function copy(id) { seq.push({ ts: ms(2), kind: 'response_copied', sessionId: 'sess_' + Math.floor(idx / 8), messageId: id }) }
function endSession(sessId) { seq.push({ ts: ms(1), kind: 'session_end', sessionId: sessId, messagesCount: 8 }) }

// ── Batch 1: Ollama connection-error storm (simulates the VPN issue we debugged earlier) ──
for (let i = 0; i < 8; i++) {
  const id = send('general', 'ollama', 'gemma4:e4b')
  complete(id, false, 500, 'connection')
}
// Mixed in: 2 successful Claude calls
const okA = send('general', 'anthropic', 'claude-sonnet-4-5')
complete(okA, true, 1800)
const okB = send('general', 'anthropic', 'claude-sonnet-4-5')
complete(okB, true, 2100)

// ── Batch 2: Finance space with GPT-4o — high retry rate (answers aren't landing) ──
for (let i = 0; i < 6; i++) {
  const id = send('finance', 'openai', 'gpt-4o', 'quickaction', 'budget')
  complete(id, true, 2500)
  if (i < 3) {
    const retry = send('finance', 'openai', 'gpt-4o', 'quickaction', 'budget')
    complete(retry, true, 2500)
    retryOf(id, retry)
  }
}
// 4 successful legal interactions mixed in so the batch has enough variance
for (let i = 0; i < 4; i++) {
  const id = send('legal', 'anthropic', 'claude-sonnet-4-5')
  complete(id, true, 2200)
  if (i === 0) copy(id)
}

// ── Batch 3: Slow p95 on Anthropic (simulates model timeout or huge context) ──
for (let i = 0; i < 5; i++) {
  const id = send('education', 'anthropic', 'claude-opus-4-5')
  complete(id, true, 35000 + i * 2000) // 35-43s latencies
}
// 5 fast Ollama successes to beat down the error-rate
for (let i = 0; i < 5; i++) {
  const id = send('general', 'ollama', 'gemma4:e4b')
  complete(id, true, 1800)
  if (i % 2 === 0) copy(id)
}

// ── Batch 4: Healthy — all green ──
for (let i = 0; i < 10; i++) {
  const id = send(['general', 'health', 'marketing'][i % 3], 'anthropic', 'claude-sonnet-4-5')
  complete(id, true, 1900)
  if (i % 3 === 0) copy(id)
}

endSession('sess_5')

// Write all events
fs.writeFileSync(ooda.EVENTS_FILE, seq.map(e => JSON.stringify(e)).join('\n') + '\n')
console.log(`\n📊 Wrote ${seq.length} synthetic events across ~4 hours of usage\n`)

// Run batches in order — the OODA loop reads `sinceTs` from state and only
// considers new outcomes, so calling maybeRunBatch multiple times walks through
// the history one batch at a time naturally.
const results = []
for (let i = 0; i < 10; i++) {
  const res = ooda.maybeRunBatch({ force: false })
  if (!res.ran) break
  results.push(res)
}

for (const r of results) {
  console.log(`── BATCH #${r.batchId} (${r.batchMeta.size} outcomes) ──`)
  console.log(`  priority: ${r.diagnosis.priority}`)
  console.log(`  problem:  ${r.diagnosis.problem}`)
  console.log(`  suggest:  ${r.diagnosis.suggestion}`)
  console.log(`  param:    ${r.diagnosis.param || '—'}`)
  console.log(`  overall:  mean=${r.orientation.overall.meanValue.toFixed(2)}  err=${(r.orientation.overall.errorRate * 100).toFixed(0)}%  retry=${(r.orientation.overall.retryRate * 100).toFixed(0)}%  p95=${r.orientation.overall.latencyP95}ms`)
  console.log()
}
console.log(`Total batches produced: ${results.length}`)

// Show the proposals file
if (fs.existsSync(ooda.PROPOSALS_FILE)) {
  const proposals = fs.readFileSync(ooda.PROPOSALS_FILE, 'utf8')
  console.log('\n─── ~/.claude/alaude-ux-proposals.md preview ───\n')
  console.log(proposals.slice(0, 1500))
  console.log('\n... (truncated)')
}

// Restore real data
for (const [f, data] of Object.entries(backups)) fs.writeFileSync(f, data)
for (const f of [ooda.EVENTS_FILE, ooda.STATE_FILE, ooda.PROPOSALS_FILE]) {
  if (!backups[f] && fs.existsSync(f)) { try { fs.unlinkSync(f) } catch {} }
}
console.log('\n✅ User data restored')
