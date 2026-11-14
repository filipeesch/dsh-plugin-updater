/**
 * Trusted repositories for automatic build-script approval.
 *
 * Trust is granted per repository and never per account or by pattern. An
 * account-level rule would grant standing execution rights to code the user
 * never installed; a pattern would cover packages that do not exist yet.
 * @module dsh-plugin-updater/trust
 */

/**
 * A repository identity: a host, then two or more path segments.
 *
 * More than two is normal: GitLab addresses a project inside nested groups, so
 * `gitlab.com/group/subgroup/repo` is one repository, not three.
 */
const REPOSITORY = /^([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\/((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)$/

/**
 * Read one user-entered repository into its identity form.
 *
 * Accepts the forms a user is likely to paste: `owner/repo` on the default host,
 * a full https URL on any host, a `github:`/`gitlab:`/`bitbucket:` shorthand, an
 * scp-like address, and a trailing `.git`. Refuses anything that describes more
 * than one repository.
 * @param {unknown} value User input.
 * @param {string} defaultHost Host to assume when the input names none.
 * @returns {{ok: true, repository: string} | {ok: false, reason: string}}
 *   The identity, or why the input is refused.
 */
export function parseTrustedRepository(value, defaultHost = 'github.com') {
  if (typeof value !== 'string') return { ok: false, reason: 'not-text' }
  let text = value.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  // A pattern is a deliberate refusal, not an invalid host.
  if (/[*?]/.test(text)) return { ok: false, reason: 'pattern' }

  text = text.replace(/^git\+/, '')
  const shorthand = /^(github|gitlab|bitbucket):(.+)$/.exec(text)
  if (shorthand !== null) {
    const hosts = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }
    const host = hosts[/** @type {keyof typeof hosts} */ (shorthand[1])]
    text = `${host}/${shorthand[2]}`
  } else if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      text = `${url.host}${url.pathname}`
    } catch {
      return { ok: false, reason: 'not-a-url' }
    }
  } else if (/^[^/\s]+@[^:/\s]+:/.test(text)) {
    // scp-like: git@github.com:owner/repo
    const match = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(text)
    if (match !== null) text = `${match[1]}/${match[2]}`
  }

  text = text.replace(/^www\./i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  const segments = text.split('/').filter((segment) => segment !== '')
  if (segments.length >= 2) {
    // With a host, the first segment is it; without one, the default host is
    // assumed and every segment belongs to the path. Either way the path may be
    // nested, which GitLab subgroups require.
    const hasHost = segments.length >= 3 && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(segments[0])
    const host = hasHost ? segments[0] : defaultHost
    const path = (hasHost ? segments.slice(1) : segments).join('/')
    const candidate = `${host}/${path}`.toLowerCase()
    return REPOSITORY.test(candidate)
      ? { ok: true, repository: candidate }
      : { ok: false, reason: 'invalid-repository' }
  }
  return { ok: false, reason: segments.length === 1 ? 'missing-owner' : 'too-many-segments' }
}

/**
 * Whether a repository is trusted.
 * @param {string} repository Identity from {@link parseTrustedRepository}.
 * @param {readonly string[]} trusted Recorded identities.
 * @returns {boolean} True only for an exact match.
 */
export function isTrusted(repository, trusted) {
  if (typeof repository !== 'string' || repository === '') return false
  const target = repository.toLowerCase()
  return trusted.some((entry) => entry.toLowerCase() === target)
}

/**
 * Add a repository to the trusted list.
 * @param {readonly string[]} trusted Existing identities.
 * @param {string} repository Identity to add.
 * @returns {string[]} The new list, without duplicates.
 */
export function addTrusted(trusted, repository) {
  const target = repository.toLowerCase()
  return [...new Set([...trusted.map((entry) => entry.toLowerCase()), target])]
}

/**
 * Remove a repository from the trusted list.
 * @param {readonly string[]} trusted Existing identities.
 * @param {string} repository Identity to remove.
 * @returns {string[]} The new list.
 */
export function removeTrusted(trusted, repository) {
  const target = repository.toLowerCase()
  return trusted.filter((entry) => entry.toLowerCase() !== target)
}

/**
 * Keep only well-formed entries from a persisted list.
 * @param {unknown} value Candidate value from configuration.
 * @returns {string[]} Normalised identities.
 */
export function normaliseTrusted(value) {
  if (!Array.isArray(value)) return []
  const kept = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const parsed = parseTrustedRepository(item)
    if (parsed.ok && !kept.includes(parsed.repository)) kept.push(parsed.repository)
  }
  return kept
}
