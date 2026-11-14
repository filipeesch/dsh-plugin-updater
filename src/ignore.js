/**
 * Ignoring a specific update.
 *
 * A git candidate is ignored by commit, not by version: measured on a real
 * repository, several commits can share one declared version, and ignoring by
 * version would hide a later, different commit. A registry candidate is ignored
 * by version, which is the identity the user actually saw.
 * @module dsh-plugin-updater/ignore
 */

/**
 * The identity to record when ignoring an update.
 * @param {{
 *   kind: 'git'|'registry'|'local',
 *   commit?: string,
 *   version?: string
 * }} update The update being ignored.
 * @returns {string|undefined} The identity, or undefined when the update does
 *   not have a stable one to record.
 */
export function ignoreIdentity(update) {
  if (update.kind === 'git') {
    const commit = typeof update.commit === 'string' ? update.commit.trim() : ''
    return commit === '' ? undefined : commit.toLowerCase()
  }
  if (update.kind === 'registry') {
    const version = typeof update.version === 'string' ? update.version.trim() : ''
    return version === '' ? undefined : version
  }
  return undefined
}

/**
 * Whether an update is currently ignored.
 *
 * An entry matches one candidate by name and one identity. A different identity
 * for the same candidate is a different update, so it is reported as pending
 * again — that is what makes ignoring temporary rather than permanent.
 * @param {{
 *   name: string,
 *   kind: 'git'|'registry'|'local',
 *   commit?: string,
 *   version?: string
 * }} update Update being considered.
 * @param {readonly {name: string, identity: string}[]} ignored Recorded entries.
 * @returns {boolean} True when this exact update is ignored.
 */
export function isIgnored(update, ignored) {
  const identity = ignoreIdentity(update)
  if (identity === undefined) return false
  return ignored.some((entry) => entry.name === update.name && entry.identity.toLowerCase() === identity)
}

/**
 * Validate the shape of a persisted ignore list.
 * @param {unknown} value Candidate value from configuration.
 * @returns {{name: string, identity: string}[]} Only the well-formed entries.
 */
export function normaliseIgnored(value) {
  if (!Array.isArray(value)) return []
  const entries = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { name, identity } = /** @type {{name?: unknown, identity?: unknown}} */ (item)
    if (typeof name !== 'string' || name === '') continue
    if (typeof identity !== 'string' || identity === '') continue
    entries.push({ name, identity })
  }
  return entries
}
