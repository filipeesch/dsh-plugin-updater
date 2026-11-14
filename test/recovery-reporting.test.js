import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { restoreSavedSpec, updateGit } from '../src/apply.js'
import { loadBundle } from './helpers/bundle.js'
import { UpdaterService } from '../src/host.js'

/**
 * The recovery path has the most explicit reporting requirement in the spec:
 * when restoration fails the user must be told, and told which spec to install.
 * That is unreachable if the function that reports it rejects instead.
 */

const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

/** @type {string} */
let profileDir

before(async () => { profileDir = await mkdtemp(join(tmpdir(), 'updater-recovery-')) })
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

describe('restoreSavedSpec reports rather than rejects', () => {
  it('returns a reason for an unreadable manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-bad-json-'))
    try {
      await writeFile(join(dir, 'package.json'), '{ broken')
      const result = await restoreSavedSpec({ profileDir: dir, name: NAME, saved: SAVED })
      assert.equal(result.ok, false)
      assert.equal(typeof result.reason, 'string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns a reason for a missing manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-no-json-'))
    try {
      const result = await restoreSavedSpec({ profileDir: dir, name: NAME, saved: SAVED })
      assert.equal(result.ok, false)
      assert.match(result.reason, /ENOENT|no such file/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('never rejects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-reject-'))
    try {
      await writeFile(join(dir, 'package.json'), 'null')
      await assert.doesNotReject(() => restoreSavedSpec({ profileDir: dir, name: NAME, saved: SAVED }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a failed spec restore is part of the outcome', () => {
  it('names both failures and the spec to reinstall', async () => {
    // The install fails and the manifest cannot be written, so neither the update
    // nor the restoration completed. Both must be reported.
    const dir = await mkdtemp(join(tmpdir(), 'updater-both-'))
    try {
      await writeFile(join(dir, 'package.json'), '{ broken')
      const host = {
        async removeBundle() { return { application: 'applied' } },
        async installBundle() { return { application: 'failed' } },
      }
      await assert.doesNotReject(() => updateGit({
        name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir: dir, host,
      }))
      const result = await updateGit({
        name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir: dir, host,
      })
      assert.match(result.reason, /could not restore/)
      assert.match(result.reason, /reinstall .*#/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a spec that could not be unfixed on a successful install', async () => {
    // The update itself worked; what failed is returning the saved spec to its
    // moving form, which would leave detection blind. That is not a clean update.
    const dir = await mkdtemp(join(tmpdir(), 'updater-unfix-'))
    try {
      const host = {
        async removeBundle() { return { application: 'applied' } },
        async installBundle() { return { application: 'applied' } },
      }
      // Make the manifest unreadable only AFTER the install succeeds.
      const result = await updateGit({
        name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW,
        profileDir: join(dir, 'absent'), host,
      })
      assert.equal(result.outcome, 'updated')
      assert.equal(typeof result.specRestoreFailed, 'string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a fresh profile reports an unknown state', () => {
  it('does not reject, and says the state is not current', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-fresh-'))
    try {
      // A new profile has no manifest: the first check cannot succeed.
      const target = new UpdaterService({
        profileDir: dir,
        pluginManager: {},
        config: () => ({}),
        writeConfig: async () => {},
        emit: () => {},
      })
      const snapshot = await target.snapshot()
      assert.equal(snapshot.current, false)
      assert.equal(typeof snapshot.lastFailure, 'string')
      assert.equal(snapshot.total, 0)
      assert.deepEqual(snapshot.updates, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the pinned-spec warning persists across a reload', () => {
  // The update call returns the warning, but the panel reloads the snapshot right
  // afterwards, so a warning that lives only in the result is erased before the
  // user can see it. It has to be in the snapshot.
  /**
   * A service whose one candidate fails the way a pinned spec does.
   * @param {string} dir Profile directory.
   * @returns {object} The service.
   */
  function service(dir) {
    return new UpdaterService({
      profileDir: dir,
      pluginManager: {
        async listBundles() { return [] },
        async listVersions() { return { status: 'unavailable', reason: 'offline' } },
        async removeBundle() { return { application: 'applied' } },
        async installBundle() { return { application: 'applied' } },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
  }

  it('appears in the snapshot after the update returns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-persist-'))
    try {
      const target = service(dir)
      target.lastCheck = {
        candidates: [
          { name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED },
        ],
        updates: [{ name: NAME, kind: 'git', state: 'update', installed: '0.34.0', identity: { kind: 'commit', commit: NEW } }],
        reloads: [], unchecked: [], ignored: [], total: 1,
      }
      // The manifest is absent, so the saved spec cannot be reset.
      const result = await target.updateOne({ name: NAME })
      assert.equal(typeof result.specRestoreFailed, 'string')

      const snapshot = await target.snapshot()
      assert.deepEqual(snapshot.specRestoreFailed, [{ name: NAME, reason: result.specRestoreFailed }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('is cleared by a later update that resets the spec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-cleared-'))
    try {
      const target = service(dir)
      target.lastCheck = {
        candidates: [
          { name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED },
        ],
        updates: [{ name: NAME, kind: 'git', state: 'update', installed: '0.34.0', identity: { kind: 'commit', commit: NEW } }],
        reloads: [], unchecked: [], ignored: [], total: 1,
      }
      await target.updateOne({ name: NAME })
      assert.equal((await target.snapshot()).specRestoreFailed.length, 1)

      // A readable manifest now lets the same update reset the spec.
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { [NAME]: SAVED } }))
      await target.updateOne({ name: NAME })
      assert.deepEqual((await target.snapshot()).specRestoreFailed, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reaches the row the panel rebuilds', async () => {
    // End to end: the host records it, the snapshot carries it, and the row the
    // client rebuilds from that snapshot shows it.
    const dir = await mkdtemp(join(tmpdir(), 'updater-row-'))
    try {
      const target = service(dir)
      target.lastCheck = {
        candidates: [
          { name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED },
        ],
        updates: [{ name: NAME, kind: 'git', state: 'update', installed: '0.34.0', identity: { kind: 'commit', commit: NEW } }],
        reloads: [], unchecked: [], ignored: [], total: 1,
      }
      await target.updateOne({ name: NAME })
      const snapshot = await target.snapshot()
      const rows = loadBundle().exports.get('dsh-plugin-updater').rowsFromSnapshot(snapshot)
      const row = rows.find((entry) => entry.name === NAME)
      assert.ok(row !== undefined)
      assert.equal(typeof row.specRestoreFailed, 'string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a pinned-spec warning follows the plugin it describes', () => {
  it('is dropped once the plugin is no longer installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-prune-'))
    try {
      const target = new UpdaterService({
        profileDir: dir,
        pluginManager: {
          async listBundles() { return [] },
          async listVersions() { return { status: 'unavailable', reason: 'offline' } },
          async removeBundle() { return { application: 'applied' } },
          async installBundle() { return { application: 'applied' } },
        },
        config: () => ({}),
        writeConfig: async () => {},
        emit: () => {},
      })
      target.lastCheck = {
        candidates: [
          { name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED },
        ],
        updates: [{ name: NAME, kind: 'git', state: 'update', installed: '0.34.0', identity: { kind: 'commit', commit: NEW } }],
        reloads: [], unchecked: [], ignored: [], total: 1,
      }
      await target.updateOne({ name: NAME })
      assert.equal((await target.snapshot()).specRestoreFailed.length, 1)

      // The user removes the plugin: the warning now describes nothing.
      target.lastCheck = { candidates: [], updates: [], reloads: [], unchecked: [], ignored: [], total: 0 }
      assert.deepEqual((await target.snapshot()).specRestoreFailed, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('a restart requirement follows the plugin it describes', () => {
  /**
   * A service with one installed candidate.
   * @param {string} dir Profile directory.
   * @returns {object} The service.
   */
  function service(dir) {
    return new UpdaterService({
      profileDir: dir,
      pluginManager: { async listBundles() { return [] } },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
  }

  it('reports a restart for a plugin that is still installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-restart-'))
    try {
      const target = service(dir)
      target.lastCheck = {
        candidates: [{ name: NAME, parsed: { kind: 'registry' }, version: '1.0.0' }],
        updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
      }
      target.restartRequired.push(NAME)
      assert.deepEqual((await target.snapshot()).restartRequired, [NAME])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('drops it once the plugin is removed', async () => {
    // A removed plugin needs no restart, and asking for one that changes nothing
    // is worse than silence.
    const dir = await mkdtemp(join(tmpdir(), 'updater-restart-gone-'))
    try {
      const target = service(dir)
      target.lastCheck = {
        candidates: [{ name: NAME, parsed: { kind: 'registry' }, version: '1.0.0' }],
        updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
      }
      target.restartRequired.push(NAME)
      assert.deepEqual((await target.snapshot()).restartRequired, [NAME])

      target.lastCheck = { candidates: [], updates: [], reloads: [], unchecked: [], ignored: [], total: 0 }
      assert.deepEqual((await target.snapshot()).restartRequired, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the pinned-spec record is bounded, not only filtered', () => {
  it('shrinks the internal record when plugins are removed', async () => {
    // Hiding an entry from the snapshot bounds what the client sees, not what the
    // process holds. Nothing else ever removes an entry for a plugin the user
    // uninstalled, so the record would grow for the life of the process.
    const dir = await mkdtemp(join(tmpdir(), 'updater-bound-'))
    try {
      const target = new UpdaterService({
        profileDir: dir,
        pluginManager: { async listBundles() { return [] } },
        config: () => ({}),
        writeConfig: async () => {},
        emit: () => {},
      })
      for (let index = 0; index < 200; index += 1) {
        target.specRestoreFailures.set(`plugin-${index}`, 'could not write')
      }
      target.lastCheck = {
        candidates: [{ name: 'plugin-0', parsed: { kind: 'registry' }, version: '1.0.0' }],
        updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
      }

      const snapshot = await target.snapshot()
      assert.deepEqual(snapshot.specRestoreFailed.map((entry) => entry.name), ['plugin-0'])
      // The record itself now holds one entry, not 200.
      assert.equal(target.specRestoreFailures.size, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps an entry for a plugin that is still installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'updater-keep-'))
    try {
      const target = new UpdaterService({
        profileDir: dir,
        pluginManager: { async listBundles() { return [] } },
        config: () => ({}),
        writeConfig: async () => {},
        emit: () => {},
      })
      target.specRestoreFailures.set('kept', 'disk full')
      target.lastCheck = {
        candidates: [{ name: 'kept', parsed: { kind: 'registry' }, version: '1.0.0' }],
        updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
      }
      const snapshot = await target.snapshot()
      assert.deepEqual(snapshot.specRestoreFailed, [{ name: 'kept', reason: 'disk full' }])
      assert.equal(target.specRestoreFailures.size, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
