/**
 * tool-batch — how the agent loop runs the tool calls a model asked for.
 *
 * WHY THIS IS ITS OWN FILE
 *   The three agent loops in api-worker.js each executed tool calls
 *   strictly one at a time. Models routinely ask for several files in a
 *   single turn, so a five-file read cost five round-trips of latency for
 *   no reason at all. Concurrency here is the single largest wall-clock
 *   win available in the harness.
 *
 *   It lives outside api-worker.js because that file is a child-process
 *   script: it starts consuming stdin at load, so requiring it from a test
 *   would simply hang. Ordering semantics are the sharp edge of this
 *   change and they need to be directly testable.
 */

/**
 * Tools safe to run at the same time as each other: they only read, they
 * share no mutable state, and none of them can raise an approval dialog
 * (two dialogs racing for the same window would be its own bug).
 *
 * This is an ALLOW-LIST on purpose. A deny-list would silently
 * parallelise every tool added later, which is precisely the wrong
 * default — the failure mode is a data race nobody can reproduce.
 *
 * Deliberately excluded: write_file, run_command, start_dev_server,
 * open_in_browser (side effects + approval gates); browser_* and screen_*
 * actions (inherently ordered — a click means nothing out of sequence);
 * generate_image (writes files, expensive); use_skill and spawn_subagent
 * (can do anything); every mcp_* tool (side effects unknowable).
 */
const PARALLEL_SAFE_TOOLS = new Set([
  'read_file',
  'list_directory',
  'web_search',
  'fetch_page',
  'browser_get_text',
  'browser_screenshot',
  'health_calculator',
  'check_drug_interactions',
  'analyze_lab_result',
])

/** Hard ceiling on tool-use rounds within a single user message. */
const MAX_AGENT_TURNS = 24

/**
 * Execute one turn's worth of tool calls.
 *
 * Only ADJACENT runs of parallel-safe calls are grouped, so anything that
 * mutates state acts as a barrier. Given [read A, write B, read C], A and
 * C are NOT run together: C may be reading exactly what B wrote, and
 * reordering that is a data race a user could never diagnose. Grouping
 * only neighbours keeps the model's intended sequence intact while still
 * collapsing the common case — several reads in a row.
 *
 * @param {Array<{name: string}>} calls  in the model's requested order
 * @param {(call: any, index: number) => Promise<any>} run
 * @returns {Promise<any[]>} results, in the same order as `calls`
 */
async function executeToolBatch(calls, run) {
  const list = Array.isArray(calls) ? calls : []
  const results = new Array(list.length)
  let i = 0
  while (i < list.length) {
    if (!PARALLEL_SAFE_TOOLS.has(list[i]?.name)) {
      results[i] = await run(list[i], i)
      i++
      continue
    }
    const start = i
    while (i < list.length && PARALLEL_SAFE_TOOLS.has(list[i]?.name)) i++
    const idxs = []
    for (let k = start; k < i; k++) idxs.push(k)
    await Promise.all(idxs.map(async (k) => { results[k] = await run(list[k], k) }))
  }
  return results
}

/**
 * Shown when the agent spends its whole turn budget.
 *
 * Before this existed the loop just ended and returned whatever text had
 * accumulated, so a job abandoned half-way looked exactly like a finished
 * answer. Saying so plainly — and saying it is resumable — is the whole
 * point.
 */
function turnBudgetNotice(used) {
  // Leads with the word that matters. An earlier version opened with "I
  // stopped after N rounds…", which read as a completion summary when it
  // sat above a long log of successful tool calls — the owner saw exactly
  // that output and concluded the task was done. It wasn't; it had stopped
  // at step 23 of 30.
  return `\n\n---\n\n⏳ **NOT FINISHED** — I used all ${used} rounds of tool use allowed for one message and stopped part-way. ` +
    `Nothing above is wrong, but the job is incomplete. Say "continue" and I'll pick up exactly where I left off.`
}

module.exports = { PARALLEL_SAFE_TOOLS, MAX_AGENT_TURNS, executeToolBatch, turnBudgetNotice }
