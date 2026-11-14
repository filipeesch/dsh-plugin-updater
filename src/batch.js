/**
 * Running several updates in sequence.
 *
 * Sequential rather than parallel because the package manager serialises on the
 * profile lock anyway, and because a queue that continues after a failure gives
 * a result the user can read: three outcomes, each attributable to one plugin.
 * @module dsh-plugin-updater/batch
 */

/**
 * Run a queue of updates.
 *
 * A failure never stops the queue. Cancellation does: it abandons everything
 * not yet started, because the user's intent when cancelling a batch is to stop
 * the batch, not to skip one item.
 * @param {{
 *   items: readonly {name: string, kind: 'registry'|'git'|'local'}[],
 *   run: (item: object) => Promise<{outcome: string} & object>,
 *   signal?: AbortSignal,
 *   onResult?: (name: string, result: object) => void
 * }} input Queue, the per-item operation, and cancellation.
 * @returns {Promise<{results: {name: string, outcome: string, result?: object}[], cancelled: boolean}>}
 *   One result per item attempted, plus whether the queue was abandoned.
 */
export async function runBatch(input) {
  const results = []
  // Installations first; a local reload restarts a module and must not land in
  // the middle of an installation.
  const ordered = [...input.items].sort((left, right) => rank(left.kind) - rank(right.kind))
  for (const item of ordered) {
    if (input.signal?.aborted === true) {
      return { results, cancelled: true }
    }
    // A throwing item is contained here too, not only in the caller: a sequencer
    // that discards the results of items it already ran is a trap regardless of
    // how carefully its one caller behaves.
    let result
    try {
      result = await input.run(item)
    } catch (error) {
      result = { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    const entry = { name: item.name, outcome: result.outcome, result }
    results.push(entry)
    input.onResult?.(item.name, result)
  }
  // `cancelled` describes an abandoned queue, which the loop above already
  // returned for. A signal that fires after the last item finished did not
  // cancel anything.
  return { results, cancelled: false }
}

/**
 * Sort rank of a candidate kind: lower runs first.
 * @param {'registry'|'git'|'local'} kind Candidate kind.
 * @returns {number} The rank.
 */
function rank(kind) {
  if (kind === 'registry') return 0
  if (kind === 'git') return 1
  return 2
}
