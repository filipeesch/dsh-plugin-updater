import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { reloadLocal, updateGit, updateRegistry } from '../src/apply.js'
import { isPinned } from '../src/spec.js'

/** @type {string} */
let profileDir
const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a39fef73ff6b885c2f39ccef86dcd75559405048'
const NEW = '7bfa1f9694b3d0aa0000000000000000000000ab'

/**
 * Write a profile manifest with the candidate installed.
 * @param {string} value Saved dependency value.
 * @returns {Promise<void>}
 */
async function writeManifest(value) {
  const manifest = { name: 'p', private: true, dependencies: { [NAME]: value } }
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/**
 * The saved value currently in the manifest.
 * @returns {Promise<string>} The value.
 */
async function savedValue() {
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  return manifest.dependencies[NAME]
}

/**
 * A host that records the specs it installs and always succeeds.
 * @param {{failInstall?: boolean}} [options] Failure switch.
 * @returns {object} The host double and its calls.
 */
function hostDouble(options = {}) {
  const calls = []
  return {
    calls,
    async removeBundle(name) {
      calls.push(['remove', name])
      return { changed: true, application: 'applied', stage: 'remove', target: name }
    },
    async installBundle(spec) {
      calls.push(['install', spec])
      // The host saves the spec it was given, as the real one does.
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      manifest.dependencies[NAME] = spec
      await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
      if (options.failInstall === true) throw new Error('install failed')
      return { changed: true, application: 'applied', stage: 'install', target: spec }
    },
  }
}

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-apply-'))
})

after(async () => {
  await rm(profileDir, { recursive: true, force: true })
})

describe('updateGit', () => {
  it('leaves the saved spec unfixed after success', async () => {
    await writeManifest(SAVED)
    const host = hostDouble()
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'updated')
    assert.equal(await savedValue(), SAVED)
    assert.equal(isPinned(await savedValue(), NAME), false)
  })

  it('installs the target commit during the attempt', async () => {
    await writeManifest(SAVED)
    const host = hostDouble()
    await updateGit({ name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host })
    const install = host.calls.find(([kind]) => kind === 'install')
    assert.ok(install[1].endsWith(`#${NEW}`))
  })

  it('restores the previous commit when installation fails', async () => {
    await writeManifest(SAVED)
    // Fail the first install, succeed the restoration.
    let attempts = 0
    const host = {
      calls: [],
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        this.calls.push(spec)
        attempts += 1
        if (attempts === 1) throw new Error('install failed')
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'restored')
    assert.equal(host.calls.length, 2)
    assert.ok(host.calls[1].endsWith(`#${OLD}`))
  })

  it('leaves the saved spec as it was after a failed update', async () => {
    await writeManifest(SAVED)
    const host = {
      calls: [],
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        this.calls.push(spec)
        // The host saves the pinned spec before failing, as the real one does.
        const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
        manifest.dependencies[NAME] = spec
        await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
        throw new Error('install failed')
      },
    }
    await updateGit({ name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host })
    assert.equal(await savedValue(), SAVED)
  })

  it('reports a failed removal without installing', async () => {
    await writeManifest(SAVED)
    const host = {
      calls: [],
      async removeBundle() { throw new Error('bundle in use') },
      async installBundle(spec) { this.calls.push(spec); return { application: 'applied' } },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.step, 'remove')
    assert.equal(host.calls.length, 0)
    assert.equal(await savedValue(), SAVED)
  })

  it('restores when cancelled after removal', async () => {
    await writeManifest(SAVED)
    const controller = new AbortController()
    const host = {
      calls: [],
      async removeBundle() {
        controller.abort()
        return { application: 'applied' }
      },
      async installBundle(spec) { this.calls.push(spec); return { application: 'applied' } },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      signal: controller.signal,
    })
    assert.equal(result.outcome, 'cancelled')
    assert.ok(host.calls[0].endsWith(`#${OLD}`))
    assert.equal(await savedValue(), SAVED)
  })
})

describe('updateRegistry', () => {
  it('delegates to the host and reports success', async () => {
    const host = { async updateBundle(name, version) { return { result: { application: 'applied' }, to: version } } }
    const result = await updateRegistry({ name: 'x', version: '1.2.3', host })
    assert.equal(result.outcome, 'updated')
  })

  it('reports a host-reported failure', async () => {
    const host = { async updateBundle() { return { result: { application: 'failed' } } } }
    const result = await updateRegistry({ name: 'x', version: '1.2.3', host })
    assert.equal(result.outcome, 'failed')
  })

  it('reports a thrown failure', async () => {
    const host = { async updateBundle() { throw new Error('nope') } }
    const result = await updateRegistry({ name: 'x', version: '1.2.3', host })
    assert.equal(result.outcome, 'failed')
    assert.match(result.reason, /nope/)
  })
})

describe('reloadLocal', () => {
  it('toggles the bundle off then on', async () => {
    const seen = []
    const host = { async setBundleEnabled(name, enabled) { seen.push(enabled); return { application: 'applied' } } }
    const result = await reloadLocal({ name: 'x', host })
    assert.equal(result.outcome, 'reloaded')
    assert.deepEqual(seen, [false, true])
  })

  it('reports a failure without re-enabling', async () => {
    const seen = []
    const host = { async setBundleEnabled(name, enabled) { seen.push(enabled); if (!enabled) throw new Error('off failed'); return {} } }
    const result = await reloadLocal({ name: 'x', host })
    assert.equal(result.outcome, 'failed')
    assert.deepEqual(seen, [false])
  })
})
