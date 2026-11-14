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

/**
 * The state of one candidate after a check.
 *
 * `current` means nothing to do; `update` means an action is available;
 * `unchecked` means the check could not establish the state, and is deliberately
 * distinct from `current` so a broken repository is never reported as up to date.
 * @typedef {{
 *   name: string,
 *   kind: 'registry'|'git'|'local',
 *   state: 'current'|'update'|'unchecked',
 *   installed?: string,
 *   repository?: string,
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
  const target = (answer.versions ?? []).find((version) => version.incompatible === undefined)
    ?? (answer.versions ?? [])[0]
  if (target === undefined || installed === undefined) {
    return { name: input.name, kind: 'registry', state: 'current', ...installed === undefined ? {} : { installed } }
  }
  if (!isNewer(target.version, installed)) {
    return { name: input.name, kind: 'registry', state: 'current', installed }
  }
  return {
    name: input.name,
    kind: 'registry',
    state: 'update',
    installed,
    identity: { kind: 'version', installed, available: target.version },
    ...target.deprecated === undefined ? {} : { reason: `deprecated: ${target.deprecated}` },
  }
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
