/**
 * Reading the build-script approval keys pnpm reports.
 *
 * pnpm's `allowBuilds` key embeds the resolved commit, so every new commit needs
 * a new key and stale keys accumulate: measured on a real profile, 31 keys had
 * built up of which 29 named commits that no longer existed. This module only
 * extracts keys; writing them happens in `approve.js`.
 *
 * A key that would carry a credential is deliberately never extracted. Writing
 * one would put an access token into the profile settings file.
 * @module dsh-plugin-updater/build-approval
 */

/** Where a non-interactive run lists scripts it skipped. */
const IGNORED_SCRIPTS = /Ignored build scripts:\s*(.+)/

/** The key pnpm suggests when it refuses to prepare a git-hosted package. */
const GIT_PREPARE = /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED[\s\S]*?^allowBuilds:\s*\n[ \t]+(.+?):\s*true\s*$/m

/**
 * Whether an approval key names a URL that carries a credential.
 *
 * The key form is `<package>@<url>`, and the URL may be an scp-like address or
 * an http(s) URL with a user and password.
 * @param {string} key Candidate approval key.
 * @returns {boolean} True when the key must not be recorded.
 */
export function carriesCredential(key) {
  const at = sourceSeparator(key)
  if (at === -1) {
    // No separator found, yet the key carries a URL: the shape is one this code
    // cannot parse, and an unparseable URL is refused rather than assumed safe.
    return key.includes('://')
  }
  const url = key.slice(at + 1)
  // scp-like addresses carry no password field: `pkg@git@host:owner/repo` names
  // a user, and refusing it would refuse every scp install.
  if (url.startsWith('//') === false && url.includes('://') === false && url.includes('@')) return false
  try {
    const parsed = new URL(url.replace(/^git\+/, ''))
    if (parsed.password !== '' || parsed.username !== '') return true
  } catch {
    // An address the URL parser rejects may still embed a credential in its
    // authority, which is exactly what must not be written down.
    return /^[a-z+]+:\/\/[^/]*@/i.test(url)
  }
  return false
}

/**
 * Whether a key is a wildcard or otherwise not an exact package identity.
 *
 * A wildcard key would approve a whole family of packages, which is broader
 * than the repository the user trusted.
 * @param {string} key Candidate approval key.
 * @returns {boolean} True when the key is not exact.
 */
export function isPattern(key) {
  return /[*?]/.test(key)
}

/**
 * The exact approval keys a package manager run reported as blocked.
 *
 * A refusal for a git-hosted package prints both the package name (as ignored
 * scripts) and the commit-scoped `allowBuilds` key. Only the scoped key is
 * actionable, so a bare name is dropped when a scoped key names that package.
 * @param {unknown} output Captured run output.
 * @returns {string[]} Keys in report order, without duplicates, patterns, or
 *   credential-bearing keys.
 */
export function blockedBuildKeys(output) {
  const text = typeof output === 'string' ? output : ''
  const ignored = IGNORED_SCRIPTS.exec(text)?.[1]?.split(',') ?? []
  const git = GIT_PREPARE.exec(text)?.[1]
  // The scoped key is the only one pnpm accepts for a git-hosted package.
  const scoped = git === undefined ? [] : [splitKey(git.trim()).packageName]
  const candidates = [...ignored, ...(git === undefined ? [] : [git])]
  const seen = new Set()
  const keys = []
  for (const raw of candidates) {
    const key = stripTrailingPunctuation(raw.trim())
    if (key === '' || isPattern(key) || carriesCredential(key)) continue
    const { source } = splitKey(key)
    // A bare name alongside a scoped key for the same package is the same
    // refusal reported twice; the scoped key is the one to record.
    if (source === undefined && scoped.includes(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/**
 * Trim sentence punctuation a run may append after a package name.
 * @param {string} value Candidate key.
 * @returns {string} The key without trailing `.`, `,`, or `;`.
 */
function stripTrailingPunctuation(value) {
  return value.replace(/[.,;]+$/, '')
}

/**
 * Split an approval key into the package name and the source it resolves to.
 *
 * The separator is the `@` that precedes the source, not merely the first `@`:
 * a scoped package name begins with one, so `@acme/plugin@https://host/path`
 * splits after the name rather than at its first character.
 * @param {string} key Approval key such as `pkg@https://host/path`.
 * @returns {{packageName: string, source?: string}} The parts; `source` is
 *   absent for a key naming a registry package.
 */
export function splitKey(key) {
  const from = sourceSeparator(key)
  if (from === -1) return { packageName: key }
  return { packageName: key.slice(0, from), source: key.slice(from + 1) }
}

/**
 * The index of the `@` that separates a package name from its source.
 *
 * A scoped name begins with `@`, so the separator is the next one after the
 * scope, never the first character. Shared deliberately: two functions finding
 * this boundary in two ways is how one of them ended up splitting a scoped key
 * at its own leading `@` and missing a credential.
 * @param {string} key Approval key.
 * @returns {number} The separator index, or -1 when the key names no source.
 */
function sourceSeparator(key) {
  if (!key.startsWith('@')) return key.indexOf('@')
  // A scope is `@scope/name`. Without that slash there is no scope boundary, and
  // guessing one lands inside the URL: in `@scope@https://user:secret@host/repo`
  // the next `/` belongs to `https://`, so the `@` that follows it is the
  // credential's, and the secret would be treated as part of the name.
  const scopeEnd = key.indexOf('/')
  const next = key.indexOf('@', 1)
  // A valid scope is `@scope/name`, so its slash comes before the separator. An
  // `@` before the slash means the slash belongs to the source URL instead, and
  // there is no scope boundary to find.
  if (scopeEnd === -1 || (next !== -1 && next < scopeEnd)) return -1
  return key.indexOf('@', scopeEnd + 1)
}

/**
 * Hosts that serve a repository's archive rather than its web pages.
 *
 * GitHub hands a git dependency to `codeload.github.com`, so the source of an
 * approval key is not the host the user typed when they trusted the repository.
 * Without this mapping every GitHub key would fail to match its own trust.
 */
const ARCHIVE_HOSTS = new Map([
  ['codeload.github.com', 'github.com'],
])

/**
 * The repository host a source host belongs to.
 * @param {string} host Host from a source URL.
 * @returns {string} The host the repository is trusted under.
 */
function repositoryHost(host) {
  const clean = host.toLowerCase().replace(/^www\./, '')
  return ARCHIVE_HOSTS.get(clean) ?? clean
}

/**
 * The repository a source URL resolves to: its host and path segments.
 *
 * Archive URLs carry the commit and a host-specific suffix after the repository
 * path — `codeload.github.com/o/r/tar.gz/<sha>`, `gitlab.com/g/r/-/archive/…`,
 * `bitbucket.org/o/r/get/<sha>.tar.gz`, a self-hosted `/archive/<sha>`. Only the
 * host is certain here; how much of the path is the repository is decided by
 * comparing against a trusted identity in {@link keyBelongsToTrusted}.
 * @param {string} source Source from an approval key.
 * @returns {{host: string, path: string}|undefined} The parsed source, or
 *   undefined when it is not a URL this plugin can attribute.
 */
function sourceLocation(source) {
  // scp-like: `git@host:owner/repo`
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(source)
  if (scp !== null) {
    return { host: repositoryHost(scp[1]), path: cleanPath(scp[2]) }
  }
  try {
    const url = new URL(source.replace(/^git\+/, ''))
    return { host: repositoryHost(url.host), path: cleanPath(url.pathname) }
  } catch {
    // A bare name, a local path, or a credential-bearing address we refuse to
    // record. None of them names a repository that can be matched to trust.
    return undefined
  }
}

/**
 * Normalise a path for comparison.
 * @param {string} path Raw path.
 * @returns {string} Lowercase, without leading or trailing slashes.
 */
function cleanPath(path) {
  return path.toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
}

/**
 * Whether an approval key belongs to a repository the user trusted.
 *
 * Trust is per repository, so the comparison is on parsed identity with segment
 * boundaries, never on substrings: a substring test approves `o/safe-malware`
 * and `o/safe2` for a user who trusted `o/safe`, and approves a foreign host
 * whose path happens to contain the trusted identity. Either mistake runs a
 * third party's build script without asking, which is the one thing this list
 * exists to prevent.
 * @param {string} key Approval key.
 * @param {readonly string[]} trustedRepositories Trust identities such as `github.com/owner/repo`.
 * @returns {boolean} True when the key's source is that repository and no other.
 */
/**
 * Segments that begin an archive download rather than a repository path.
 *
 * Every host appends one of these after the repository: GitHub
 * `owner/repo/tar.gz/<sha>`, GitLab `group/repo/-/archive/<sha>/repo-<sha>.tar.gz`,
 * Bitbucket `owner/repo/get/<sha>.tar.gz`, and a self-hosted server usually
 * `team/repo/archive/<sha>.tar.gz`. Stripping at the first marker recovers the
 * repository path, which can then be compared for equality.
 */
const ARCHIVE_MARKERS = ['/-/archive/', '/-/tar.gz/', '/tar.gz/', '/get/', '/archive/', '/zipball/', '/tarball/']

/**
 * Whether a source path is a repository path plus an archive suffix.
 *
 * The test is "is this path that repository", asked from the repository side,
 * rather than "strip the suffix and compare". That direction is the one that
 * survives a path containing a marker word: a project at `gitlab.com/g/get/repo`
 * is recognised because the path begins with its own name followed by an archive
 * marker, while `.../safe/nested/...` is refused because `nested` is not one.
 * @param {string} path Cleaned source path.
 * @param {string} repository Cleaned trusted repository path.
 * @returns {boolean} True when the path addresses exactly that repository.
 */
function addressesRepository(path, repository) {
  if (path === repository) return true
  if (!path.startsWith(`${repository}/`)) return false
  const rest = path.slice(repository.length)
  return ARCHIVE_MARKERS.some((marker) => rest.startsWith(marker))
}

/**
 * Whether an approval key belongs to a repository the user trusted.
 *
 * Trust is per repository, so the comparison is on parsed identity and must be
 * exact: a substring or prefix test approves `o/safe-malware` and `o/safe2` for
 * a user who trusted `o/safe`, approves a foreign host whose path merely
 * mentions the trusted identity, and approves a nested project under a trusted
 * path. Each of those runs a third party's build script without asking, which is
 * the one thing this list exists to prevent.
 * @param {string} key Approval key.
 * @param {readonly string[]} trustedRepositories Trust identities such as `github.com/owner/repo`.
 * @returns {boolean} True when the key's source is that repository and no other.
 */
export function keyBelongsToTrusted(key, trustedRepositories) {
  const { source } = splitKey(key)
  if (source === undefined) return false
  const location = sourceLocation(source)
  if (location === undefined) return false
  if (location.path === '') return false
  return trustedRepositories.some((repository) => {
    const [rawHost, ...rest] = repository.toLowerCase().split('/')
    if (rawHost === undefined || rest.length === 0) return false
    if (location.host !== rawHost.replace(/^www\./, '')) return false
    return addressesRepository(location.path, cleanPath(rest.join('/')))
  })
}
