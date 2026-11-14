/**
 * Deciding what to do about a blocked build script.
 *
 * A build script runs arbitrary code at install time, so it is never approved
 * because the package looks familiar. It is approved when the user has trusted
 * that exact repository, and only for the exact keys pnpm reported: a wildcard
 * would cover packages that do not exist yet.
 *
 * The decision is pure so it can be tested without running a package manager.
 * @module dsh-plugin-updater/approve
 */

import { blockedBuildKeys, keyBelongsToTrusted, splitKey } from './build-approval.js'

/**
 * Decide how to handle the build scripts a failed run reported.
 * @param {{
 *   pendingBuilds?: readonly string[],
 *   output?: string,
 *   repository: string,
 *   trustedRepositories: readonly string[]
 * }} input What the run reported and what the user trusts.
 * @returns {{
 *   decision: 'none'|'approve'|'ask',
 *   keys: string[],
 *   deferred?: string[],
 *   repository: string
 * }} `none` when nothing was blocked, `approve` with the exact keys to allow,
 *   `ask` with the keys that need the user and, when some keys belong to the
 *   trusted repository and others do not, `deferred` holds the trusted ones so
 *   a single untrusted transitive script does not block the whole update.
 */
export function decideBuildApproval(input) {
  // The reported key list is authoritative when present; the output is parsed
  // only when a run failed before naming the keys.
  const reported = [...(input.pendingBuilds ?? [])]
  const keys = reported.length > 0 ? dedupe(reported.filter(isUsable)) : blockedBuildKeys(input.output)
  if (keys.length === 0) return { decision: 'none', keys: [], repository: input.repository }

  const trusted = keys.filter((key) => keyBelongsToTrusted(key, input.trustedRepositories))
  const untrusted = keys.filter((key) => !keyBelongsToTrusted(key, input.trustedRepositories))
  if (untrusted.length === 0) return { decision: 'approve', keys: trusted, repository: input.repository }
  return {
    decision: 'ask',
    keys: untrusted,
    ...trusted.length === 0 ? {} : { deferred: trusted },
    repository: input.repository,
  }
}

/**
 * Whether a reported key is worth acting on at all.
 * @param {string} key Reported key.
 * @returns {boolean} False for an empty key or a wildcard.
 */
function isUsable(key) {
  return typeof key === 'string' && key.trim() !== '' && !/[*?]/.test(key)
}

/**
 * Remove duplicates while keeping order.
 * @param {string[]} keys Keys.
 * @returns {string[]} Deduplicated keys.
 */
function dedupe(keys) {
  return [...new Set(keys)]
}

/**
 * The disclosure shown when a script was approved automatically.
 * @param {string} repository Repository that was trusted.
 * @param {readonly string[]} keys Keys that were written.
 * @returns {{repository: string, packages: string[], keys: string[]}} What to show.
 */
export function describeApproval(repository, keys) {
  return { repository, keys: [...keys], packages: keys.map((key) => splitKey(key).packageName) }
}
