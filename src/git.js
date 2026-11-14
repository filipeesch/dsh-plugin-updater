/**
 * Reading a repository over git: HEAD, the manifest at HEAD, and the commits
 * between two revisions.
 *
 * `git ls-remote` and a blobless clone are used instead of the GitHub API. An
 * unauthenticated API allows 60 requests per hour, which is too few for a check
 * every 60 minutes across several repositories; git reuses the machine's
 * existing credentials, so private repositories work, and it has no such budget.
 * @module dsh-plugin-updater/git
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Deadline for one git command, in milliseconds. */
export const GIT_TIMEOUT_MS = 30_000

/** Environment that stops git from prompting for a password or a host key. */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  SSH_ASKPASS_REQUIRE: 'never',
  LC_ALL: 'C',
}

/**
 * Run one git command.
 * @param {string[]} args Arguments after `git`.
 * @param {{cwd?: string, timeoutMs?: number}} [options] Working directory and deadline.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, timedOut: boolean}>}
 *   The outcome; `ok` is false for a non-zero exit or a deadline.
 */
export async function git(args, options = {}) {
  try {
    const { stdout, stderr } = await run('git', args, {
      cwd: options.cwd,
      env: GIT_ENV,
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      reject: false,
    })
    return { ok: true, stdout, stderr, timedOut: false }
  } catch (error) {
    const failed = /** @type {{stdout?: string, stderr?: string, killed?: boolean}} */ (error)
    return {
      ok: false,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? String(error),
      timedOut: failed.killed === true,
    }
  }
}

/**
 * The default-branch HEAD commit of a remote repository.
 * @param {string} url Clone URL.
 * @returns {Promise<{ok: true, commit: string} | {ok: false, reason: 'unreachable'|'missing'|'empty'}>}
 *   The commit, or why it could not be read.
 */
export async function remoteHead(url) {
  const result = await git(['ls-remote', '--exit-code', '--', url, 'HEAD'])
  if (!result.ok) {
    const text = `${result.stderr}${result.stdout}`
    if (/not found|Repository not found|does not exist|No such remote branch/i.test(text)) return { ok: false, reason: 'missing' }
    // A deadline and a refusal are different problems for the user: one is worth
    // retrying, the other needs credentials or a correct address.
    if (result.timedOut) return { ok: false, reason: 'timeout' }
    if (/permission denied|could not read|authentication failed|access denied/i.test(text)) {
      return { ok: false, reason: 'denied' }
    }
    return { ok: false, reason: 'unreachable' }
  }
  const commit = result.stdout.trim().split(/\s+/)[0] ?? ''
  return /^[a-f0-9]{7,40}$/i.test(commit) ? { ok: true, commit } : { ok: false, reason: 'empty' }
}

/**
 * The `version` a repository declares at one revision.
 *
 * Read through `git show` against the clone rather than the raw file endpoint,
 * so a private repository works with the same credentials as the clone.
 * @param {string} mirror Bare clone directory.
 * @param {string} commit Revision to read.
 * @returns {Promise<string|undefined>} The declared version, or undefined.
 */
export async function versionAt(mirror, commit) {
  const result = await git(['show', `${commit}:package.json`], { cwd: mirror })
  if (!result.ok) return undefined
  try {
    const manifest = JSON.parse(result.stdout)
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * The commits between two revisions, newest first.
 * @param {string} mirror Bare clone directory.
 * @param {string} from Older revision.
 * @param {string} to Newer revision.
 * @returns {Promise<{commit: string, subject: string, author?: string}[]>} Commit list; empty when the range is unreadable.
 */
export async function commitsBetween(mirror, from, to) {
  const result = await git(['log', '--format=%H%x09%an%x09%s', `${from}..${to}`], { cwd: mirror })
  if (!result.ok) return []
  const commits = []
  for (const line of result.stdout.split('\n')) {
    if (line.trim() === '') continue
    const [commit, author, subject] = line.split('\t')
    if (commit === undefined) continue
    commits.push({
      commit,
      subject: subject ?? '',
      ...author === undefined || author === '' ? {} : { author },
    })
  }
  return commits
}

/**
 * Whether a commit exists in a repository's history.
 * @param {string} mirror Bare clone directory.
 * @param {string} commit Revision to look for.
 * @returns {Promise<boolean>} True when the clone knows it.
 */
export async function hasCommit(mirror, commit) {
  const result = await git(['cat-file', '-e', `${commit}^{commit}`], { cwd: mirror })
  return result.ok
}
