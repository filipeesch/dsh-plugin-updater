/**
 * Running a whole check: every candidate, in parallel, with the ignore list and
 * the failure state applied.
 * @module dsh-plugin-updater/check
 */

import { checkGit, checkRegistry } from './detect.js'
import { isIgnored } from './ignore.js'
import { pendingTotal } from './version.js'

/**
 * Check every candidate.
 *
 * A candidate that cannot be checked becomes `unchecked` and never fails the
 * others: one repository that was deleted must not hide updates elsewhere. That
 * includes a candidate whose check throws, because the candidates run in
 * parallel and a rejection would take the whole result with it.
 * @param {{
 *   candidates: readonly {name: string, version?: string, parsed: object}[],
 *   commits: Map<string, string>,
 *   cache: import('./clone-cache.js').CloneCache,
 *   listVersions: (name: string) => Promise<object>,
 *   remoteHead?: (url: string) => Promise<object>,
 *   ignored?: readonly {name: string, identity: string}[]
 * }} input Candidates and host capabilities.
 * @returns {Promise<{
 *   states: object[],
 *   updates: object[],
 *   blocked: object[],
 *   ignored: object[],
 *   unchecked: object[],
 *   total: number,
 *   checkedAt: number
 * }>} The outcome of the check.
 */
export async function runCheck(input) {
  const ignored = input.ignored ?? []
  const states = await Promise.all(input.candidates.map(async (candidate) => {
    try {
      return await checkOne(input, candidate)
    } catch (error) {
      // `Promise.all` propagates a rejection, so an uncontained throw here would
      // discard every other candidate's result rather than one.
      return {
        name: candidate.name,
        kind: kindOf(candidate),
        state: 'unchecked',
        reason: error instanceof Error ? error.message : String(error),
        ...candidate.version === undefined ? {} : { installed: candidate.version },
      }
    }
  }))

  const updates = []
  const blocked = []
  const ignoredUpdates = []
  const unchecked = []
  for (const state of states) {
    if (state.state === 'unchecked') {
      unchecked.push(state)
      continue
    }
    // Newer versions exist but none can run here. It is reported so the user
    // knows why nothing happens, and it is not counted as pending work.
    if (state.state === 'blocked') {
      blocked.push(state)
      continue
    }
    if (state.state !== 'update') continue
    const identity = /** @type {{kind: string, available?: string, commit?: string}} */ (state.identity)
    const entry = { name: state.name, kind: state.kind, version: identity.available, commit: identity.commit }
    if (isIgnored(entry, ignored)) ignoredUpdates.push({ ...state, ignored: true })
    else updates.push(state)
  }

  return {
    states,
    updates,
    blocked,
    ignored: ignoredUpdates,
    unchecked,
    total: pendingTotal({ updates: updates.length, failed: unchecked.length }),
    checkedAt: Date.now(),
  }
}

/**
 * Check one candidate along the path its source implies.
 * @param {object} input Candidates and host capabilities.
 * @param {{name: string, version?: string, parsed: object}} candidate One candidate.
 * @returns {Promise<object>} Its state.
 */
async function checkOne(input, candidate) {
  const parsed = /** @type {{kind: string, repository?: string}} */ (candidate.parsed)
  if (parsed.kind === 'registry') {
    return checkRegistry({
      name: candidate.name,
      installed: candidate.version,
      listVersions: input.listVersions,
    })
  }
  if (parsed.kind === 'git' && parsed.repository !== undefined) {
    return checkGit({
      name: candidate.name,
      repository: parsed.repository,
      installedVersion: candidate.version,
      installedCommit: input.commits.get(candidate.name),
      cache: input.cache,
      ...input.remoteHead === undefined ? {} : { remoteHead: input.remoteHead },
    })
  }
  return {
    name: candidate.name,
    kind: 'local',
    state: 'current',
    ...candidate.version === undefined ? {} : { installed: candidate.version },
  }
}

/**
 * The candidate kind, for a failure that happened before one was established.
 * @param {{parsed?: unknown}} candidate One candidate.
 * @returns {'git'|'registry'|'local'} The kind.
 */
function kindOf(candidate) {
  const kind = typeof candidate.parsed === 'object' && candidate.parsed !== null
    ? /** @type {{kind?: unknown}} */ (candidate.parsed).kind
    : undefined
  return kind === 'git' ? 'git' : kind === 'local' ? 'local' : 'registry'
}
