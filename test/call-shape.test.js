import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/**
 * The gateway calls a method with one named object per declared parameter.
 *
 * Every descriptor in `remote.js` declares a single `request` parameter, so each
 * host method receives `{ ... }` as its first argument — never a bare string.
 * These tests use that shape, which is the seam the earlier suite left open.
 */

/** @type {string} */
let profileDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-call-'))
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'p', dependencies: {} }, undefined, 2)}\n`)
})
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * A service with no real profile.
 * @param {object} config Row configuration.
 * @returns {object} The service.
 */
function service(config = {}) {
  return new UpdaterService({
    profileDir,
    pluginManager: {},
    config: () => config,
    writeConfig: async () => {},
    emit: () => {},
  })
}

describe('gateway call shape', () => {
  it('updateOne reads the name from its request object', async () => {
    const target = service()
    target.lastCheck = {
      candidates: [{ name: 'plug', parsed: { kind: 'registry' }, version: '1.0.0' }],
      updates: [{ name: 'plug', kind: 'registry', state: 'update', installed: '1.0.0', identity: { kind: 'version', installed: '1.0.0', available: '1.1.0' } }],
      reloads: [], unchecked: [], ignored: [], total: 1,
    }
    target.pluginManager = { async updateBundle() { return { result: { application: 'applied' } } } }
    // A bare string would be read as the request and produce an empty name.
    const result = await target.updateOne({ name: 'plug' })
    assert.equal(typeof result, 'object')
  })

  it('updateOne refuses a request without a name', async () => {
    const target = service()
    await assert.rejects(() => target.updateOne({}), /needs the name/)
  })

  it('updateOne refuses a bare string, which is not the wire shape', async () => {
    const target = service()
    // A string has no `name` property, so it is refused rather than silently
    // updating nothing.
    await assert.rejects(() => target.updateOne('plug'), /needs the name/)
  })

  it('saveConfig reads its patch from the request object', async () => {
    const seen = []
    const target = new UpdaterService({
      profileDir,
      pluginManager: {},
      config: () => ({}),
      writeConfig: async (next) => { seen.push(next) },
      emit: () => {},
    })
    target.lastCheck = { updates: [], reloads: [], unchecked: [], ignored: [], total: 0, candidates: [] }
    const snapshot = await target.saveConfig({ trustedRepositories: ['github.com/o/r'] })
    assert.deepEqual(seen[0].trustedRepositories, ['github.com/o/r'])
    // A settings write must return the full state, not only the configuration:
    // the caller replaces its snapshot with the result.
    assert.equal(typeof snapshot, 'object')
    assert.ok('updates' in snapshot)
    assert.ok('total' in snapshot)
  })

  it('clearCache returns the full state, not only usage', async () => {
    const target = service()
    target.lastCheck = { updates: [], reloads: [], unchecked: [], ignored: [], total: 0, candidates: [] }
    const snapshot = await target.clearCache()
    // Returning only usage would blank the panel and the count.
    assert.ok('updates' in snapshot)
    assert.ok('total' in snapshot)
    assert.ok('cache' in snapshot)
  })

  it('snapshot reports whether the last check is current', async () => {
    const target = service()
    target.lastCheck = { updates: [], reloads: [], unchecked: [], ignored: [], total: 0, candidates: [] }
    const fresh = await target.snapshot()
    assert.equal(fresh.current, true)
    target.checkFailure = 'network down'
    const stale = await target.snapshot()
    assert.equal(stale.current, false)
    assert.equal(stale.lastFailure, 'network down')
  })

  it('cancel aborts the queue it owns', async () => {
    const target = service()
    const controller = new AbortController()
    target.cancellation = controller
    assert.deepEqual(target.cancel(), { cancelled: true })
    assert.equal(controller.signal.aborted, true)
  })
})

describe('restart reporting', () => {
  it('records a nested restart requirement', () => {
    const target = service()
    target.noteRestart('plug', { result: { application: 'restart-required' } })
    assert.deepEqual(target.restartRequired, ['plug'])
  })

  it('records a direct restart requirement, as the git path reports it', () => {
    const target = service()
    target.noteRestart('plug', { application: 'restart-required' })
    assert.deepEqual(target.restartRequired, ['plug'])
  })

  it('records nothing for an applied change', () => {
    const target = service()
    target.noteRestart('plug', { application: 'applied' })
    assert.deepEqual(target.restartRequired, [])
  })
})
