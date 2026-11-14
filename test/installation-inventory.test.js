import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/**
 * The spec requires that a bundle the DSH installation provides is never offered
 * as a candidate. The Host reports that as
 * `BundleInfo.availability === 'installation'`, so the plugin has to ask the
 * Host rather than guess from a name list of its own.
 */

/** @type {string} */
let profileDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-inventory-'))
  const names = ['shipped-bundle', 'profile-bundle']
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'p',
    dependencies: Object.fromEntries(names.map((name) => [name, '^1.0.0'])),
  }))
  for (const name of names) {
    await mkdir(join(profileDir, 'node_modules', name), { recursive: true })
    await writeFile(join(profileDir, 'node_modules', name, 'package.json'), JSON.stringify({
      name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
  }
})

after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * A service whose package manager reports one bundle as installation-supplied.
 * @param {object[]} bundles What `listBundles` returns.
 * @returns {object} The service.
 */
function service(bundles) {
  return new UpdaterService({
    profileDir,
    pluginManager: {
      async listBundles() { return bundles },
      async listVersions() { return { status: 'unavailable', reason: 'offline' } },
    },
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
}

describe('installation inventory', () => {
  it('turns availability installation into a predicate', async () => {
    const target = service([
      { name: 'shipped-bundle', availability: 'installation' },
      { name: 'profile-bundle', availability: 'profile' },
    ])
    const provides = await target.installedByHarness()
    assert.equal(provides('shipped-bundle'), true)
    assert.equal(provides('profile-bundle'), false)
  })

  it('excludes an installation-supplied bundle from a check', async () => {
    const target = service([{ name: 'shipped-bundle', availability: 'installation' }])
    const result = await target.check()
    const names = (result.candidates ?? []).map((entry) => entry.name)
    assert.deepEqual(names, ['profile-bundle'])
  })

  it('keeps every bundle when the host reports none as installation-supplied', async () => {
    const target = service([])
    const result = await target.check()
    const names = (result.candidates ?? []).map((entry) => entry.name)
    assert.deepEqual(names.sort(), ['profile-bundle', 'shipped-bundle'])
  })

  it('survives a host without listBundles', async () => {
    // An older Host offers no inventory: excluding nothing is the only option,
    // and it must not break the check.
    const target = new UpdaterService({
      profileDir,
      pluginManager: { async listVersions() { return { status: 'unavailable', reason: 'offline' } } },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
    const result = await target.check()
    assert.equal((result.candidates ?? []).length, 2)
  })

  it('survives a throwing listBundles', async () => {
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() { throw new Error('inventory unavailable') },
        async listVersions() { return { status: 'unavailable', reason: 'offline' } },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
    const result = await target.check()
    assert.equal((result.candidates ?? []).length, 2)
  })

  it('reads the inventory once per host start', async () => {
    let calls = 0
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() { calls += 1; return [] },
        async listVersions() { return { status: 'unavailable', reason: 'offline' } },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
    await target.check()
    await target.check()
    assert.equal(calls, 1)
  })
})

describe('a transient inventory failure is not cached', () => {
  it('retries after a failure and then excludes the shipped bundle', async () => {
    // The inventory is stable once read, but a read can fail transiently. Caching
    // that failure would leave a bundle the Harness ships updatable for the rest
    // of the process, which is the one outcome the exclusion exists to prevent.
    let attempt = 0
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() {
          attempt += 1
          if (attempt === 1) throw new Error('startup race')
          return [{ name: 'shipped-bundle', availability: 'installation' }]
        },
        async listVersions() { return { status: 'unavailable', reason: 'offline' } },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })

    // First cycle: the inventory is unreadable, so nothing is excluded.
    const first = await target.check()
    assert.deepEqual((first.candidates ?? []).map((entry) => entry.name).sort(), ['profile-bundle', 'shipped-bundle'])

    // Second cycle: the read succeeds, and the shipped bundle is excluded.
    const second = await target.check()
    assert.deepEqual((second.candidates ?? []).map((entry) => entry.name), ['profile-bundle'])
    assert.equal(attempt, 2)
  })

  it('still caches a successful read', async () => {
    let calls = 0
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() { calls += 1; return [] },
        async listVersions() { return { status: 'unavailable', reason: 'offline' } },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
    await target.check()
    await target.check()
    await target.check()
    assert.equal(calls, 1)
  })
})

describe('a broken candidate does not abandon the batch', () => {
  it('updates the healthy candidates and reports the broken one as failed', async () => {
    // end to end through the service: a candidate whose state cannot produce a
    // target makes runItem throw, and the queue must still run the rest.
    const dir = await mkdtemp(join(tmpdir(), 'updater-batch-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: 'p',
        dependencies: { 'broken-npm': '^1.0.0', 'good-npm': '^1.0.0' },
      }))
      for (const [name, extra] of [
        ['broken-npm', { dsh: { bundle: { patch: './cordis.patch.yml' } } }],
        ['good-npm', { dsh: { bundle: { patch: './cordis.patch.yml' } } }],
      ]) {
        await mkdir(join(dir, 'node_modules', name), { recursive: true })
        await writeFile(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...extra }))
      }

      const updated = []
      const target = new UpdaterService({
        profileDir: dir,
        pluginManager: {
          async listBundles() { return [] },
          async listVersions() { return { status: 'unavailable', reason: 'offline' } },
          async updateBundle(name) { updated.push(name); return { result: { application: 'applied' } } },
        },
        config: () => ({}),
        writeConfig: async () => {},
        emit: () => {},
      })

      // A candidate whose state carries no available version cannot produce a
      // target: runItem throws for it, which is the failure this case contains.
      target.lastCheck = {
        candidates: [
          { name: 'broken-npm', parsed: { kind: 'registry', range: '^1.0.0' }, version: '1.0.0' },
          { name: 'good-npm', parsed: { kind: 'registry', range: '^1.0.0' }, version: '1.0.0' },
        ],
        updates: [
          { name: 'broken-npm', kind: 'registry', state: 'update', installed: '1.0.0', identity: { kind: 'version' } },
          { name: 'good-npm', kind: 'registry', state: 'update', installed: '1.0.0', identity: { kind: 'version', available: '1.1.0' } },
        ],
        reloads: [], unchecked: [], ignored: [], total: 2,
      }

      const outcome = await target.updateAll()
      // Both are attempted, in queue order, and each has its own outcome: the
      // point is that one failure did not consume the other's result.
      assert.equal(outcome.results.length, 2)
      const byName = new Map(outcome.results.map((entry) => [entry.name, entry.outcome]))
      assert.equal(byName.get('broken-npm'), 'failed')
      assert.equal(byName.get('good-npm'), 'updated')
      assert.deepEqual(updated, ['good-npm'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
