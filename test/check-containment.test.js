import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCheck } from '../src/check.js'

/**
 * A check runs its candidates in parallel, so a rejection from one would discard
 * every other result rather than one. Both the candidate and the clone cache are
 * therefore contained, and these cases express failure as a throw, which is the
 * shape the earlier tests never used.
 */

/**
 * A cache whose `ensure` fails in a given way.
 * @param {{throwOnEnsure?: boolean}} [options] Failure mode.
 * @returns {object} The cache double.
 */
function cacheDouble(options = {}) {
  return {
    async ensure() {
      if (options.throwOnEnsure === true) throw new Error('cache directory is not writable')
      return { ok: false, reason: 'clone-failed' }
    },
  }
}

/** A registry candidate that reports a newer version. */
const registryCandidate = { name: 'npm-a', version: '1.0.0', parsed: { kind: 'registry' } }

/** A git candidate. */
const gitCandidate = { name: 'git-b', version: '1.0.0', parsed: { kind: 'git', repository: 'github.com/o/r' } }

/** An unreachable remote, so a git candidate never leaves the process. */
const offlineRemote = async () => ({ ok: false, reason: 'unreachable' })

describe('a throwing candidate does not fail the check', () => {
  it('reports the throwing candidate as unchecked and keeps the others', async () => {
    const result = await runCheck({
      candidates: [registryCandidate, gitCandidate],
      commits: new Map(),
      cache: cacheDouble({ throwOnEnsure: true }),
      // The registry candidate is answered; the git one needs a remote head,
      // which this environment cannot reach, so its own path already reports
      // `unchecked`. What matters is that the registry result survives.
      remoteHead: offlineRemote,
      listVersions: async () => ({
        status: 'listed',
        installed: '1.0.0',
        versions: [{ version: '1.1.0', bundle: true }],
      }),
    })
    assert.equal(result.states.length, 2)
    assert.deepEqual(result.updates.map((entry) => entry.name), ['npm-a'])
  })

  it('never rejects, whatever the candidates do', async () => {
    await assert.doesNotReject(() => runCheck({
      candidates: [
        { name: 'broken', version: '1.0.0', parsed: { kind: 'git', repository: 'github.com/o/r' } },
      ],
      commits: new Map(),
      cache: cacheDouble({ throwOnEnsure: true }),
      remoteHead: offlineRemote,
      listVersions: async () => { throw new Error('registry unreachable') },
    }))
  })

  it('contains a registry lookup that throws', async () => {
    const result = await runCheck({
      candidates: [
        { name: 'a', version: '1.0.0', parsed: { kind: 'registry' } },
        { name: 'b', version: '1.0.0', parsed: { kind: 'registry' } },
      ],
      commits: new Map(),
      cache: cacheDouble(),
      listVersions: async (name) => {
        if (name === 'a') throw new Error('registry exploded')
        return { status: 'listed', installed: '1.0.0', versions: [{ version: '2.0.0', bundle: true }] }
      },
    })
    // The healthy candidate's update survives the broken one's throw.
    assert.deepEqual(result.updates.map((entry) => entry.name), ['b'])
    const broken = result.unchecked.find((entry) => entry.name === 'a')
    assert.ok(broken !== undefined)
    assert.match(broken.reason, /registry exploded/)
  })

  it('keeps the kind of a candidate that threw', async () => {
    const result = await runCheck({
      candidates: [{ name: 'g', version: '1.0.0', parsed: { kind: 'git', repository: 'github.com/o/r' } }],
      commits: new Map(),
      cache: cacheDouble({ throwOnEnsure: true }),
      remoteHead: offlineRemote,
      listVersions: async () => ({ status: 'unavailable', reason: 'offline' }),
    })
    assert.equal(result.states[0].kind, 'git')
  })
})

describe('an unwritable cache does not fail a check', () => {
  it('reports it as a reason rather than throwing', async () => {
    const { CloneCache } = await import('../src/clone-cache.js')
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'updater-cache-'))
    try {
      // A regular file where the cache directory should be: mkdir fails.
      const blocked = join(dir, 'not-a-directory')
      await writeFile(blocked, 'x')
      const cache = new CloneCache({ directory: blocked })
      const result = await cache.ensure('github.com/o/r', (repository) => `https://${repository}`)
      assert.equal(result.ok, false)
      assert.equal(typeof result.reason, 'string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a malformed candidate is contained too', () => {
  // This is the case that actually escapes `checkOne` (the registry and git
  // paths catch their own failures), so it is the one that proves the wrapper
  // does anything. Without it the healthy candidate's result is discarded.
  it('keeps the healthy candidate when another is malformed', async () => {
    const result = await runCheck({
      candidates: [
        { name: 'bad', parsed: null },
        { name: 'ok', version: '1.0.0', parsed: { kind: 'registry' } },
      ],
      commits: new Map(),
      cache: cacheDouble(),
      listVersions: async () => ({ status: 'listed', installed: '1.0.0', versions: [{ version: '2.0.0', bundle: true }] }),
    })
    assert.deepEqual(result.updates.map((entry) => entry.name), ['ok'])
    const broken = result.unchecked.find((entry) => entry.name === 'bad')
    assert.ok(broken !== undefined, 'the malformed candidate is reported, not dropped')
    assert.equal(typeof broken.reason, 'string')
  })

  it('does not reject the whole check', async () => {
    await assert.doesNotReject(() => runCheck({
      candidates: [{ name: 'bad', parsed: null }],
      commits: new Map(),
      cache: cacheDouble(),
      listVersions: async () => ({ status: 'unavailable', reason: 'offline' }),
    }))
  })
})

describe('clearing an unremovable cache entry', () => {
  it('reports what it removed instead of rejecting', async () => {
    // A cache is disposable, so one entry that cannot be removed must not turn
    // "clear the cache" into an error with no state change.
    const { CloneCache } = await import('../src/clone-cache.js')
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const root = await mkdtemp(join(tmpdir(), 'updater-clear-'))
    const cacheDir = join(root, 'clones')
    try {
      await mkdir(join(cacheDir, 'removable'), { recursive: true })
      await writeFile(join(cacheDir, 'removable', 'HEAD'), 'ref: x')
      const cache = new CloneCache({ directory: cacheDir })
      const result = await cache.clear()
      assert.equal(result.removed, 1)
      assert.equal(result.failed, 0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a failed removal rather than rejecting', async () => {
    // Removing a child needs write access to its parent, so a read-only cache
    // root is the real way an entry survives: this is the case that threw.
    const { CloneCache } = await import('../src/clone-cache.js')
    const { chmod, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const root = await mkdtemp(join(tmpdir(), 'updater-clear-ro-'))
    const cacheDir = join(root, 'clones')
    try {
      await mkdir(join(cacheDir, 'child'), { recursive: true })
      await writeFile(join(cacheDir, 'child', 'HEAD'), 'ref: x')
      await chmod(cacheDir, 0o500)
      try {
        const result = await new CloneCache({ directory: cacheDir }).clear()
        assert.equal(result.removed, 0)
        assert.equal(result.failed, 1)
      } finally {
        await chmod(cacheDir, 0o700)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never rejects on a cache root that cannot be listed', async () => {
    const { CloneCache } = await import('../src/clone-cache.js')
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const root = await mkdtemp(join(tmpdir(), 'updater-clear2-'))
    try {
      const blocked = join(root, 'a-file')
      await writeFile(blocked, 'x')
      const cache = new CloneCache({ directory: blocked })
      await assert.doesNotReject(() => cache.clear())
      const result = await cache.clear()
      assert.equal(result.removed, 0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
