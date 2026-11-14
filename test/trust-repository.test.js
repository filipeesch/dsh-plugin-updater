import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/** @type {string} */
let profileDir
/** @type {string} */
let cacheDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-trust-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'updater-trust-cache-'))
})
after(async () => {
  await rm(profileDir, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

/**
 * A service whose configuration writes are recorded.
 * @param {object} initial Initial row configuration.
 * @returns {object} The service and its write log.
 */
function service(initial = {}) {
  let raw = initial
  const writes = []
  const target = new UpdaterService({
    profileDir, cacheDir,
    pluginManager: {},
    config: () => raw,
    writeConfig: async (next) => { writes.push(next); raw = next },
    emit: () => {},
  })
  return { target, writes }
}

/**
 * Put one installed candidate into the last check.
 * @param {object} target Service.
 * @param {object} parsed Parsed dependency facts.
 * @returns {void}
 */
function candidate(target, parsed) {
  target.lastCheck = {
    candidates: [{ name: 'plugin-a', version: '1.0.0', saved: 'github:o/r', parsed }],
    updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
  }
}

describe('trustRepository', () => {
  it('adds exactly the candidate repository', async () => {
    const { target, writes } = service()
    candidate(target, { kind: 'git', repository: 'github.com/o/r' })
    const snapshot = await target.trustRepository({ name: 'plugin-a' })
    assert.deepEqual(writes[0].trustedRepositories, ['github.com/o/r'])
    assert.deepEqual(snapshot.trustedRepositories, ['github.com/o/r'])
  })

  it('does not write when the repository is already trusted', async () => {
    const { target, writes } = service({ trustedRepositories: ['github.com/o/r'] })
    candidate(target, { kind: 'git', repository: 'github.com/o/r' })
    await target.trustRepository({ name: 'plugin-a' })
    assert.equal(writes.length, 0)
  })

  it('refuses a registry candidate', async () => {
    const { target } = service()
    candidate(target, { kind: 'registry', range: '^1.0.0' })
    await assert.rejects(() => target.trustRepository({ name: 'plugin-a' }), /not installed from a git repository/)
  })

  it('refuses an unknown candidate', async () => {
    const { target } = service()
    candidate(target, { kind: 'git', repository: 'github.com/o/r' })
    await assert.rejects(() => target.trustRepository({ name: 'other' }), /not an installed plugin candidate/)
  })

  it('refuses a repository that is not a repository identity', async () => {
    const { target } = service()
    candidate(target, { kind: 'git', repository: 'nope' })
    await assert.rejects(() => target.trustRepository({ name: 'plugin-a' }), /could not be read/)
  })

  it('ignores a repository supplied by the caller', async () => {
    const { target, writes } = service()
    candidate(target, { kind: 'git', repository: 'github.com/o/r' })
    await target.trustRepository({ name: 'plugin-a', repository: 'github.com/evil/repo' })
    assert.deepEqual(writes[0].trustedRepositories, ['github.com/o/r'])
  })
})
