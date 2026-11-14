/**
 * How one candidate's pending state is described to the user.
 *
 * A git repository can move without its declared version moving, so an update
 * has two possible identities: a version change, or a count of commits. Showing
 * only the version would make two different updates read as the same one —
 * measured on a real repository, the tags had stopped at 0.15.0 while the
 * manifest declared 0.35.0.
 * @module dsh-plugin-updater/display
 */

import { shortCommit } from './version.js'

/**
 * Choose how to present a git candidate's pending update.
 * @param {{
 *   installedVersion?: string,
 *   headVersion?: string,
 *   installedCommit?: string,
 *   headCommit?: string,
 *   commitCount?: number
 * }} input Facts about the installed and remote states.
 * @returns {{
 *   kind: 'version'|'commits'|'unknown',
 *   installed?: string,
 *   available?: string,
 *   commits?: number,
 *   commit?: string
 * }} What to render. `kind` is `version` when the declared version differs,
 *   `commits` when only the commit moved, `unknown` when neither is known.
 */
export function gitUpdateIdentity(input) {
  const installedVersion = clean(input.installedVersion)
  const headVersion = clean(input.headVersion)
  const commit = shortCommit(input.headCommit)
  const commits = Number.isInteger(input.commitCount) && input.commitCount > 0 ? input.commitCount : undefined

  if (installedVersion !== undefined && headVersion !== undefined && installedVersion !== headVersion) {
    return {
      kind: 'version',
      installed: installedVersion,
      available: headVersion,
      ...commits === undefined ? {} : { commits },
      ...commit === '' ? {} : { commit },
    }
  }
  if (commits !== undefined) {
    return {
      kind: 'commits',
      commits,
      ...installedVersion === undefined ? {} : { installed: installedVersion },
      ...commit === '' ? {} : { commit },
    }
  }
  // The commits differ — that is why an update is reported — but neither a
  // version change nor a count could be established.
  if (shortCommit(input.installedCommit) !== commit) {
    return { kind: 'unknown', ...commit === '' ? {} : { commit } }
  }
  return { kind: 'unknown' }
}

/**
 * Choose how to present a registry candidate's pending update.
 * @param {{installed?: string, available?: string}} input Versions.
 * @returns {{kind: 'version'|'unknown', installed?: string, available?: string}}
 *   What to render.
 */
export function registryUpdateIdentity(input) {
  const installed = clean(input.installed)
  const available = clean(input.available)
  if (installed !== undefined && available !== undefined && installed !== available) {
    return { kind: 'version', installed, available }
  }
  return { kind: 'unknown' }
}

/**
 * Trim a version into a display string.
 * @param {unknown} value Candidate version.
 * @returns {string|undefined} The trimmed value, or undefined when empty.
 */
function clean(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Summarise a finished batch by outcome.
 * @param {readonly {outcome: string}[]} results Per-candidate outcomes.
 * @returns {{
 *   updated: number, reloaded: number, needsApproval: number, failed: number,
 *   restored: number, cancelled: number, total: number
 * }} Counts by outcome, plus the total processed.
 */
export function summariseBatch(results) {
  const counts = { updated: 0, reloaded: 0, needsApproval: 0, failed: 0, restored: 0, cancelled: 0, total: results.length }
  for (const { outcome } of results) {
    if (Object.hasOwn(counts, outcome) && outcome !== 'total') counts[/** @type {keyof typeof counts} */ (outcome)] += 1
  }
  return counts
}

/**
 * Whether a batch summary needs the user's attention.
 * @param {{needsApproval?: number, failed?: number}} summary Batch counts.
 * @returns {boolean} True when at least one candidate needs a decision or failed.
 */
export function needsAttention(summary) {
  return (summary.needsApproval ?? 0) > 0 || (summary.failed ?? 0) > 0
}
