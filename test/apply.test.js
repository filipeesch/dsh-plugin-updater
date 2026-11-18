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
 * @returns {object} The host double and its calls.
 */
function hostDouble() {
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
      return { changed: true, application: 'applied', stage: 'install', target: spec }
    },
  }
}

/**
 * The refusal a host with hot module replacement reports for an installed package.
 * @returns {Error} The failure the host resolves or throws with.
 */
function alreadyInstalled() {
  return Object.assign(new Error('the package is already installed'), { code: 'already-installed' })
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

  it('installs the target commit over the running package first', async () => {
    await writeManifest(SAVED)
    const host = hostDouble()
    await updateGit({ name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host })
    assert.deepEqual(host.calls.map(([kind]) => kind), ['install'])
    assert.ok(host.calls[0][1].endsWith(`#${NEW}`))
  })

  it('leaves the installed package in place when the install-over attempt fails', async () => {
    await writeManifest(SAVED)
    const calls = []
    const host = {
      async removeBundle() { calls.push('remove'); return { application: 'applied' } },
      async installBundle() { calls.push('install'); throw new Error('registry unreachable') },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.step, 'install')
    assert.deepEqual(calls, ['install'])
    assert.match(result.reason, /registry unreachable/)
    assert.equal(await savedValue(), SAVED)
  })

  it('removes and retries when the host refuses to install over the package', async () => {
    await writeManifest(SAVED)
    const calls = []
    const host = {
      async removeBundle() { calls.push('remove'); return { changed: true, application: 'applied' } },
      async installBundle(spec) {
        calls.push(['install', spec])
        if (calls.length === 1) throw alreadyInstalled()
        const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
        manifest.dependencies[NAME] = spec
        await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
        return { changed: true, application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'updated')
    assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? 'install' : entry), ['install', 'remove', 'install'])
    assert.ok(calls.at(-1)[1].endsWith(`#${NEW}`))
    assert.equal(await savedValue(), SAVED)
  })

  it('restores the previous commit when the retry after removal fails', async () => {
    await writeManifest(SAVED)
    const installed = []
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        installed.push(spec)
        // The first attempt is the refusal that removes the package; the retry
        // fails for a real reason, so the previous commit comes back.
        if (installed.length === 1) throw alreadyInstalled()
        if (installed.length === 2) throw new Error('install failed')
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'restored')
    assert.equal(installed.length, 3)
    assert.ok(installed.at(-1).endsWith(`#${OLD}`))
  })

  it('leaves the saved spec as it was after a failed update', async () => {
    await writeManifest(SAVED)
    const host = {
      async installBundle(spec) {
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

  it('reports a failed removal without installing again', async () => {
    await writeManifest(SAVED)
    const installed = []
    const host = {
      async removeBundle() { throw new Error('bundle in use') },
      async installBundle(spec) {
        installed.push(spec)
        if (installed.length === 1) throw alreadyInstalled()
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.step, 'remove')
    assert.equal(installed.length, 1)
    assert.equal(await savedValue(), SAVED)
  })

  it('passes the request id to every installation', async () => {
    await writeManifest(SAVED)
    const options = []
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec, received) { options.push(received); return { application: 'applied' } },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      requestId: 'updater:plugin:1',
    })
    assert.equal(result.outcome, 'updated')
    assert.ok(options.length > 0)
    assert.ok(options.every((option) => option.requestId === 'updater:plugin:1'))
  })

  it('restores when cancelled after removal', async () => {
    await writeManifest(SAVED)
    const controller = new AbortController()
    const calls = []
    const host = {
      async removeBundle() {
        controller.abort()
        return { application: 'applied' }
      },
      async installBundle(spec) {
        calls.push(spec)
        if (calls.length === 1) throw alreadyInstalled()
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      signal: controller.signal,
    })
    assert.equal(result.outcome, 'cancelled')
    assert.ok(calls[1].endsWith(`#${OLD}`))
    assert.equal(await savedValue(), SAVED)
  })
})

describe('updateRegistry', () => {
  it('delegates to the host and reports success', async () => {
    const host = { async updateBundle(name, version) { return { result: { application: 'applied' }, to: version } } }
    const result = await updateRegistry({ name: 'x', version: '1.2.3', host })
    assert.equal(result.outcome, 'updated')
  })

  it('passes the request id and the answering registry to the host', async () => {
    let seen
    const host = { async updateBundle(name, version, options) { seen = options; return { result: { application: 'applied' } } } }
    await updateRegistry({ name: 'x', version: '1.2.3', host, requestId: 'updater:x:1', registry: 'https://registry.example/' })
    assert.deepEqual(seen, { requestId: 'updater:x:1', registry: 'https://registry.example/' })
  })

  it('reports a host-reported failure with its code and diagnostic', async () => {
    const host = {
      async updateBundle() {
        return { result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'ERR_PNPM_NO_MATCHING_VERSION' } } }
      },
    }
    const result = await updateRegistry({ name: 'x', version: '1.2.3', host })
    assert.equal(result.outcome, 'failed')
    assert.match(result.reason, /operation-error/)
    assert.match(result.reason, /ERR_PNPM_NO_MATCHING_VERSION/)
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
