/**
 * Version arithmetic for the entries this plugin shows.
 *
 * Everything here is pure: no filesystem, no network, no clock. The host's own
 * semver rules decide whether a registry version is newer; this module only
 * formats and clamps what the user reads.
 * @module dsh-plugin-updater/version
 */

/** Highest count rendered as a number before the badge collapses to `9+`. */
export const COUNT_LIMIT = 9

/**
 * A semver-shaped string: three dot-separated numbers with an optional
 * prerelease or build tail.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

/**
 * Split a version into comparable parts.
 * @param {unknown} value Candidate version string.
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]}|undefined}
 *   Parsed parts, or undefined when the value is not a semver-shaped string.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = SEMVER.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Whether a string is a semver-shaped version.
 * @param {unknown} value Candidate version.
 * @returns {boolean} True when {@link parseVersion} accepts it.
 */
export function isVersion(value) {
  return parseVersion(value) !== undefined
}

/**
 * Compare two prerelease identifier lists using semver precedence: numeric
 * identifiers compare numerically and rank below alphanumeric ones, and a
 * shorter list that is a prefix of a longer one ranks lower.
 * @param {string[]} left First identifiers.
 * @param {string[]} right Second identifiers.
 * @returns {number} Negative, zero, or positive.
 */
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  // A release ranks above any prerelease of the same core.
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) - Number(b)
    if (aNumeric) return -1
    if (bNumeric) return 1
    return a < b ? -1 : 1
  }
  return left.length - right.length
}

/**
 * Compare two versions by semver precedence.
 * @param {string} left First version.
 * @param {string} right Second version.
 * @returns {number|undefined} Negative when left is older, positive when newer,
 *   zero when equal; undefined when either side is not a version.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Whether a version is strictly newer than another.
 * @param {string} candidate Version being considered.
 * @param {string} installed Version currently installed.
 * @returns {boolean} True only when both parse and the candidate is newer.
 */
export function isNewer(candidate, installed) {
  const order = compareVersions(candidate, installed)
  return order !== undefined && order > 0
}

/**
 * Clamp a count for display.
 * @param {number} count Pending items.
 * @returns {string} The number, or `9+` above the limit; empty for zero or less.
 */
export function formatCount(count) {
  if (!Number.isFinite(count) || count <= 0) return ''
  return count > COUNT_LIMIT ? `${COUNT_LIMIT}+` : String(count)
}

/**
 * Whether the badge should render at all.
 * @param {number} count Pending items.
 * @returns {boolean} True when a count is worth showing.
 */
export function hasCount(count) {
  return formatCount(count) !== ''
}

/**
 * The total the sidebar reports: updates, pending reloads, and failed checks.
 * @param {{updates?:number,reloads?:number,failed?:number}} parts Counts by kind.
 * @returns {number} The sum, never negative.
 */
export function pendingTotal(parts) {
  const sum = (parts.updates ?? 0) + (parts.reloads ?? 0) + (parts.failed ?? 0)
  return Number.isFinite(sum) && sum > 0 ? sum : 0
}

/**
 * The short form of a commit identifier for display.
 * @param {unknown} commit Full or partial commit hash.
 * @returns {string} The first seven characters, or an empty string.
 */
export function shortCommit(commit) {
  return typeof commit === 'string' && commit.trim() !== '' ? commit.trim().slice(0, 7) : ''
}
