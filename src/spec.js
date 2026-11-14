/**
 * Reading a saved profile dependency into the facts this plugin needs: where
 * the package came from, and — for a git source — which repository it names.
 *
 * The saved spec is the only trustworthy source of the repository. An installed
 * package's own `repository` field cannot be used: measured on a real profile,
 * two of four git plugins declare no repository at all, and one declares a
 * different repository than the spec it was installed from. Resolving a
 * git-installed package by name against the registry is worse still, because
 * several of these names belong to unrelated projects there.
 * @module dsh-plugin-updater/spec
 */

/** `github:owner/repo`, `gitlab:group/subgroup/repo`, and the other pnpm host shorthands. */
const SHORTHAND = /^(github|gitlab|bitbucket|gist):([^/#]+(?:\/[^/#]+)+?)(?:\.git)?(?:#(.+))?$/

/** A full git URL: `git+https://`, `https://.../x.git`, `git@host:owner/repo`. */
const GIT_URL = /^(?:git\+)?(?:https?|ssh|git):\/\//i

/** An scp-like git address. */
const SCP = /^[^@/\s]+@([^:/\s]+):([^\s]+)$/

/** A hosted repository URL, which pnpm treats as git. */
const HOSTED = /^https?:\/\/([^/]+)\/([^/]+)\/([^/#]+?)(?:\.git)?(?:#(.+))?$/i

/** A local path, recorded with the protocol pnpm writes. */
const LOCAL = /^(file|link):(.+)$/

/** A Windows absolute path. */
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/

/** A filesystem path that is not a URL. */
const UNIX_PATH = /^(?:~|\/|\.\.?[\\/])/

/** A package name: an optional scope, then URL-safe segments. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/**
 * Strip the user information of an http(s) URL so a token never reaches a
 * display string or a log line.
 * @param {string} value URL or spec.
 * @returns {string} The value without credentials.
 */
export function stripCredentials(value) {
  return value.replace(/^(git\+)?(https?):\/\/[^/]*@/i, '$1$2://')
}

/**
 * Normalise a repository identity to `host/path` with no scheme, credentials,
 * `.git` suffix, or trailing slash.
 * @param {string} host Repository host, such as `github.com`.
 * @param {string} path Repository path, such as `owner/repo`.
 * @returns {string} The identity used for trust comparison and display.
 */
export function repositoryIdentity(host, path) {
  const cleanHost = host.toLowerCase().replace(/^www\./, '')
  const cleanPath = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '')
  return `${cleanHost}/${cleanPath}`.toLowerCase()
}

/**
 * Read a saved dependency value into its source facts.
 *
 * A value is one of: a registry range (`^1.2.3`, `1.2.3`, `latest`), a git
 * shorthand, a git URL, an scp-like address, a hosted repository URL, or a
 * local path. Anything unrecognised is reported as `unknown` rather than
 * guessed, so an update path is never invented for it.
 * @param {string} name The dependency name as the profile keys it.
 * @param {unknown} value The saved value.
 * @returns {{
 *   name: string,
 *   kind: 'registry'|'git'|'local'|'unknown',
 *   range?: string,
 *   repository?: string,
 *   ref?: string,
 *   path?: string
 * }} Parsed facts; `repository` is `host/owner/repo` in lower case.
 */
export function parseDependency(name, value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return { name, kind: 'unknown' }

  const local = LOCAL.exec(text)
  if (local !== null) return { name, kind: 'local', path: local[2] }
  if (WINDOWS_PATH.test(text) || UNIX_PATH.test(text)) return { name, kind: 'local', path: text }

  const shorthand = SHORTHAND.exec(text)
  if (shorthand !== null) {
    const [, host, path, ref] = shorthand
    const hosts = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', gist: 'gist.github.com' }
    return {
      name,
      kind: 'git',
      repository: repositoryIdentity(hosts[/** @type {keyof typeof hosts} */ (host)], path),
      ...ref === undefined ? {} : { ref },
    }
  }

  const scp = SCP.exec(text)
  if (scp !== null) {
    const hash = scp[2].indexOf('#')
    const path = hash === -1 ? scp[2] : scp[2].slice(0, hash)
    return {
      name,
      kind: 'git',
      repository: repositoryIdentity(scp[1], path),
      ...hash === -1 ? {} : { ref: scp[2].slice(hash + 1) },
    }
  }

  const hosted = HOSTED.exec(text)
  if (hosted !== null) {
    const [, host, owner, repo, ref] = hosted
    return {
      name,
      kind: 'git',
      repository: repositoryIdentity(host, `${owner}/${repo}`),
      ...ref === undefined ? {} : { ref },
    }
  }

  if (GIT_URL.test(text)) {
    const withoutPrefix = text.replace(/^git\+/, '')
    try {
      const url = new URL(withoutPrefix)
      const ref = url.hash === '' ? undefined : decodeURIComponent(url.hash.slice(1))
      return {
        name,
        kind: 'git',
        repository: repositoryIdentity(url.host, url.pathname),
        ...ref === undefined || ref === '' ? {} : { ref },
      }
    } catch {
      return { name, kind: 'unknown' }
    }
  }

  // A registry value is a range, a tag, or an alias such as `npm:other@1`.
  if (!text.includes(':') || text.startsWith('npm:')) {
    if (PACKAGE_NAME.test(name)) return { name, kind: 'registry', range: text }
  }
  return { name, kind: 'unknown' }
}

/**
 * The spec that installs a git repository at one exact commit.
 *
 * A GitHub repository uses the shorthand pnpm documents; any other host uses a
 * full URL, which is what pnpm accepts for GitLab, Bitbucket, and self-hosted
 * servers.
 * @param {string} repository Identity from {@link parseDependency}.
 * @param {string} commit Commit hash to install.
 * @returns {string} A spec pnpm accepts.
 */
export function pinnedSpec(repository, commit) {
  const [host, ...rest] = repository.split('/')
  const path = rest.join('/')
  if (host === 'github.com') return `github:${path}#${commit}`
  return `git+https://${host}/${path}.git#${commit}`
}

/**
 * The spec that follows a repository's default branch.
 * @param {string} repository Identity from {@link parseDependency}.
 * @returns {string} A spec with no pinned commit.
 */
export function movingSpec(repository) {
  const [host, ...rest] = repository.split('/')
  const path = rest.join('/')
  if (host === 'github.com') return `github:${path}`
  return `git+https://${host}/${path}.git`
}

/**
 * Whether a repository is one the shorthand can address.
 * @param {string} repository Identity from {@link parseDependency}.
 * @returns {boolean} True for GitHub, whose shorthand pnpm documents.
 */
export function usesShorthand(repository) {
  return repository.split('/')[0] === 'github.com'
}

/**
 * The clone URL for a repository identity.
 * @param {string} repository Identity from {@link parseDependency}.
 * @returns {string} An https URL without credentials.
 */
export function cloneUrl(repository) {
  return `https://${repository}`
}

/**
 * Whether a saved spec still carries a pinned commit. Used to assert that an
 * update left the manifest unfixed.
 * @param {unknown} value Saved dependency value.
 * @param {string} name Dependency name.
 * @returns {boolean} True when the spec names a ref.
 */
export function isPinned(value, name) {
  const parsed = parseDependency(name, value)
  return parsed.kind === 'git' && parsed.ref !== undefined
}
