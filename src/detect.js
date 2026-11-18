/**
 * Deciding what to offer for one installed plugin.
 *
 * A registry candidate is compared through the host's own version listing. A git
 * candidate is compared by commit, because tags lag: measured on real
 * repositories, one published `v0.15.0` while its manifest declared `0.35.0`, so
 * a version-only comparison reports "current" for code that has moved.
 * @module dsh-plugin-updater/detect
 */

import { gitUpdateIdentity } from './display.js'
import { commitsBetween, hasCommit, remoteHead, versionAt } from './git.js'
import { cloneUrl, pinnedSpec } from './spec.js'
import { isNewer } from './version.js'

/** The reason text for a registry candidate with nothing installable here. */
const NO_COMPATIBLE_VERSION = 'no published version is compatible with this DeepSeek Harness'
const NO_INSTALLABLE_VERSION = 'no newer published version is installable from here'

/**
 * The state of one candidate after a check.
 *
 * `current` means nothing to do; `update` means an action is available;
 * `blocked` means newer versions exist but none can run here, and is distinct
 * from `current` so the user learns why nothing happens; `unchecked` means the
 * check could not establish the state. `blocked` is deliberately not an update:
 * offering it would be an action the host always refuses.
 * @typedef {{
 *   name: string,
 *   kind: 'registry'|'git'|'local',
 *   state: 'current'|'update'|'blocked'|'unchecked',
 *   installed?: string,
 *   repository?: string,
 *   registry?: string,
 *   identity?: object,
 *   reason?: string,
 *   notes?: {available: boolean, commits?: number, items?: object[], reason?: string}
 * }} CandidateState
 */

/**
 * Check one registry candidate through the host's version listing.
 * @param {{
 *   name: string,
 *   installed?: string,
 *   listVersions: (name: string) => Promise<object>
 * }} input Candidate and host capability.
 * @returns {Promise<CandidateState>} The state after the check.
 */
export async function checkRegistry(input) {
  let answer
  try {
    answer = await input.listVersions(input.name)
  } catch (error) {
    return { name: input.name, kind: 'registry', state: 'unchecked', reason: messageOf(error) }
  }
  if (answer?.status !== 'listed') {
    return {
      name: input.name,
      kind: 'registry',
      state: 'unchecked',
      ...input.installed === undefined ? {} : { installed: input.installed },
      reason: answer?.reason ?? 'the registry answered no version list',
    }
  }
  const installed = input.installed ?? answer.installed
  const versions = Array.isArray(answer.versions) ? answer.versions : []
  // `null` is a value, not an absence: it asks pnpm's own registry, while an
  // absent field asks the remembered or configured one.
  const registry = answer.registry === undefined ? undefined : answer.registry
  // A version that declares no bundle cannot be installed, and one the running
  // DSH rejects is refused by the host at the check step. Neither is an update.
  const target = versions.find((version) => version?.bundle === true && version.incompatible === undefined)
  if (target === undefined) {
    if (versions.length === 0 || installed === undefined) {
      return { name: input.name, kind: 'registry', state: 'current', ...installed === undefined ? {} : { installed } }
    }
    return {
      name: input.name,
      kind: 'registry',
      state: 'blocked',
      installed,
      reason: noVersionReason(versions, answer.omitted),
      ...registry === undefined ? {} : { registry },
    }
  }
  if (installed === undefined) return { name: input.name, kind: 'registry', state: 'current' }
  if (!isNewer(target.version, installed)) {
    return { name: input.name, kind: 'registry', state: 'current', installed }
  }
  return {
    name: input.name,
    kind: 'registry',
    state: 'update',
    installed,
    // The answering registry is what makes the update ask the same registry
    // order the listing did.
    identity: {
      kind: 'version', installed, available: target.version,
      ...registry === undefined ? {} : { registry },
    },
    ...target.deprecated === undefined ? {} : { reason: `deprecated: ${target.deprecated}` },
  }
}

/**
 * Why no newer version could be offered.
 * @param {object[]} versions Newer published versions.
 * @param {unknown} omitted How many newer versions the Host did not list.
 * @returns {string} The reason.
 */
function noVersionReason(versions, omitted) {
  const cause = versions.every((version) => version?.incompatible !== undefined)
    ? NO_COMPATIBLE_VERSION
    : NO_INSTALLABLE_VERSION
  const more = typeof omitted === 'number' && omitted > 0
    ? ` (${omitted} newer version${omitted === 1 ? '' : 's'} not listed here)`
    : ''
  return cause + more
}

/**
 * Check one git candidate by comparing the installed commit with the remote HEAD.
 * @param {{
 *   name: string,
 *   repository: string,
 *   installedVersion?: string,
 *   installedCommit?: string,
 *   cache: import('./clone-cache.js').CloneCache,
 *   remoteHead?: (url: string) => Promise<{ok: boolean, commit?: string, reason?: string}>,
 *   withNotes?: boolean
 * }} input Candidate, its installed facts, and the clone cache.
 * @returns {Promise<CandidateState>} The state after the check.
 */
export async function checkGit(input) {
  const head = await (input.remoteHead ?? defaultRemoteHead)(cloneUrl(input.repository))
  if (!head.ok) {
    return {
      name: input.name,
      kind: 'git',
      repository: input.repository,
      state: 'unchecked',
      reason: head.reason,
      ...input.installedVersion === undefined ? {} : { installed: input.installedVersion },
    }
  }
  if (input.installedCommit !== undefined && sameCommit(input.installedCommit, head.commit)) {
    return {
      name: input.name,
      kind: 'git',
      repository: input.repository,
      state: 'current',
      ...input.installedVersion === undefined ? {} : { installed: input.installedVersion },
    }
  }

  // The commit moved. Reading the version needs a clone; without one the update
  // is still real, it just cannot be described by version.
  const clone = await input.cache.ensure(input.repository, cloneUrl)
  const headVersion = clone.ok ? await versionAt(clone.path, head.commit) : undefined
  const commits = clone.ok && input.installedCommit !== undefined && await hasCommit(clone.path, input.installedCommit)
    ? await commitsBetween(clone.path, input.installedCommit, head.commit)
    : []
  const identity = gitUpdateIdentity({
    installedVersion: input.installedVersion,
    headVersion,
    installedCommit: input.installedCommit,
    headCommit: head.commit,
    commitCount: commits.length > 0 ? commits.length : undefined,
  })
  const notes = clone.ok
    ? commits.length > 0
      ? { available: true, commits: commits.length, items: commits }
      : { available: false, reason: 'no-commits' }
    : { available: false, reason: clone.reason }
  return {
    name: input.name,
    kind: 'git',
    repository: input.repository,
    state: 'update',
    ...input.installedVersion === undefined ? {} : { installed: input.installedVersion },
    identity: { ...identity, commit: head.commit, spec: pinnedSpec(input.repository, head.commit) },
    notes,
  }
}

/** The real remote lookup, overridable so a check can be tested offline. */
const defaultRemoteHead = remoteHead

/**
 * Whether two commit identifiers name the same commit.
 *
 * The lockfile records the full sha while a remote may report the same sha, so
 * a prefix comparison is enough and avoids a false "moved" report.
 * @param {string} left Installed commit.
 * @param {string} right Remote commit.
 * @returns {boolean} True when one is a prefix of the other.
 */
export function sameCommit(left, right) {
  const a = typeof left === 'string' ? left.trim().toLowerCase() : ''
  const b = typeof right === 'string' ? right.trim().toLowerCase() : ''
  if (a === '' || b === '') return false
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * A message from an unknown thrown value.
 * @param {unknown} error Thrown value.
 * @returns {string} Its message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
