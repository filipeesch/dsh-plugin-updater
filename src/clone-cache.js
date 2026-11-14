/**
 * A bounded cache of bare, blobless clones used to read commit messages.
 *
 * `--filter=blob:none` transfers commits and trees but not file contents, which
 * is all that `git log` needs. The bound keeps the cache from growing without
 * limit: a repository is fetched again on its next check after eviction, which is
 * slower but never wrong.
 * @module dsh-plugin-updater/clone-cache
 */

import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { git } from './git.js'

/** Default bound for the whole cache, in bytes. */
export const DEFAULT_CACHE_BYTES = 100 * 1024 * 1024

/**
 * The directory name a repository occupies in the cache.
 * @param {string} repository Repository identity such as `github.com/owner/repo`.
 * @returns {string} A stable, filesystem-safe directory name.
 */
export function cacheKey(repository) {
  const hash = createHash('sha256').update(repository).digest('hex').slice(0, 16)
  const label = repository.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)
  return `${label}-${hash}`
}

/**
 * Total size of a directory tree.
 * @param {string} path Directory.
 * @returns {Promise<number>} Bytes.
 */
async function directorySize(path) {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directorySize(child)
    else if (entry.isFile()) {
      try {
        total += (await stat(child)).size
      } catch {
        // A file that vanished mid-walk contributes nothing.
      }
    }
  }
  return total
}

/**
 * A cache of bare blobless clones.
 */
export class CloneCache {
  /**
   * @param {{directory: string, limitBytes?: number}} options Cache location and bound.
   */
  constructor(options) {
    this.directory = options.directory
    this.limitBytes = options.limitBytes ?? DEFAULT_CACHE_BYTES
  }

  /**
   * The clone directory of one repository, whether or not it exists yet.
   * @param {string} repository Repository identity.
   * @returns {string} Absolute path.
   */
  pathOf(repository) {
    return join(this.directory, cacheKey(repository))
  }

  /**
   * Ensure a repository has a clone and is up to date.
   * @param {string} repository Repository identity.
   * @param {(repository: string) => string} urlOf Clone URL builder.
   * @returns {Promise<{ok: true, path: string} | {ok: false, reason: string}>} The clone, or why it is unavailable.
   */
  async ensure(repository, urlOf) {
    const path = this.pathOf(repository)
    // This method documents a result, not a rejection, and a caller that runs
    // several repositories in parallel would otherwise lose the whole check to
    // one unwritable cache directory.
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
    } catch {
      return { ok: false, reason: 'cache-unwritable' }
    }
    let exists = false
    try {
      exists = (await stat(join(path, 'HEAD'))).isFile()
    } catch {
      exists = false
    }
    if (!exists) {
      await rm(path, { recursive: true, force: true })
      const created = await git(['clone', '--bare', '--filter=blob:none', '--quiet', '--', urlOf(repository), path])
      if (!created.ok) {
        await rm(path, { recursive: true, force: true })
        return { ok: false, reason: 'clone-failed' }
      }
    } else {
      const fetched = await git(['fetch', '--quiet', '--filter=blob:none', '--all'], { cwd: path })
      if (!fetched.ok) return { ok: false, reason: 'fetch-failed' }
    }
    // Touching the directory records the last use, which eviction reads.
    const now = new Date()
    await utimes(path, now, now)
    await this.enforceLimit()
    return { ok: true, path }
  }

  /**
   * Delete least-recently-used clones until the cache fits its bound.
   * @returns {Promise<string[]>} The removed directory names.
   */
  async enforceLimit() {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch {
      return []
    }
    const measured = []
    let total = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(this.directory, entry.name)
      let usedAt = 0
      try {
        usedAt = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      const size = await directorySize(path)
      measured.push({ name: entry.name, path, size, usedAt })
      total += size
    }
    if (total <= this.limitBytes) return []
    measured.sort((left, right) => left.usedAt - right.usedAt)
    const removed = []
    for (const entry of measured) {
      if (total <= this.limitBytes) break
      await rm(entry.path, { recursive: true, force: true })
      total -= entry.size
      removed.push(entry.name)
    }
    return removed
  }

  /**
   * Current cache usage, for the settings tab.
   * @returns {Promise<{bytes: number, repositories: number, limitBytes: number}>} Usage facts.
   */
  async usage() {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch {
      return { bytes: 0, repositories: 0, limitBytes: this.limitBytes }
    }
    let bytes = 0
    let repositories = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      repositories += 1
      bytes += await directorySize(join(this.directory, entry.name))
    }
    return { bytes, repositories, limitBytes: this.limitBytes }
  }

  /**
   * Remove every cached clone.
   *
   * A clone that cannot be removed is skipped rather than thrown: the cache is
   * disposable, so a read-only entry must not turn "clear the cache" into an
   * error with no state change.
   * @returns {Promise<{removed: number, failed: number}>} How many were removed.
   */
  async clear() {
    let entries = []
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch {
      return { removed: 0, failed: 0 }
    }
    let removed = 0
    let failed = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await rm(join(this.directory, entry.name), { recursive: true, force: true })
        removed += 1
      } catch {
        failed += 1
      }
    }
    return { removed, failed }
  }
}
