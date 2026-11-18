import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { updateGit, updateRegistry } from '../src/apply.js'

const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const KEY = `${NAME}@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/${NEW}`

/** @type {string} */
let profileDir

before(async () => { profileDir = await mkdtemp(join(tmpdir(), 'updater-recovery-shape-')) })
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * Write the profile manifest.
 * @returns {Promise<void>}
 */
async function writeManifest() {
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'p', dependencies: { [NAME]: SAVED } }, undefined, 2)}\n`)
}

/**
 * The saved dependency value.
 * @returns {Promise<string>} The value.
 */
async function savedValue() {
  return JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')).dependencies[NAME]
}

/**
 * The refusal a host reports for an installed package.
 * @returns {object} The change.
 */
function alreadyInstalled() {
  return { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }
}

/**
 * A host where every install fails, including the recovery.
 * @returns {object} The host.
 */
function brokenHost() {
  let calls = 0
  return {
    async removeBundle() { return { application: 'applied' } },
    async installBundle() {
      calls += 1
      // The refusal that removes the package, then a failing retry and a failing
      // reinstallation: both failures must be reported.
      if (calls === 1) return alreadyInstalled()
      return { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error', diagnostic: 'pnpm failed' } }
    },
  }
}

describe('recovery reporting', () => {
  it('reports a failed reinstall as a failure, not a restoration', async () => {
    await writeManifest()
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host: brokenHost(),
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.step, 'restore')
    assert.match(result.reason, /could not restore/)
    assert.match(result.reason, /reinstall .*#/)
    // The failure that started the recovery is still the diagnosis the row shows.
    assert.equal(result.result.error.code, 'operation-error')
    assert.equal(await savedValue(), SAVED)
  })

  it('reports a successful reinstall as restored', async () => {
    await writeManifest()
    let calls = 0
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        calls += 1
        if (calls === 1) return alreadyInstalled()
        if (calls === 2) return { application: 'failed', stage: 'install', error: { code: 'operation-error' } }
        return { application: 'applied', stage: 'install' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'restored')
    assert.equal(result.restore.application, 'applied')
  })

  it('reports a registry rollback honestly', async () => {
    const host = {
      async updateBundle() {
        return {
          from: '0.3.6', to: '0.3.7', step: 'install',
          result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'refused' } },
          restore: { application: 'applied' },
        }
      },
    }
    const result = await updateRegistry({ name: 'x', version: '0.3.7', host })
    assert.equal(result.outcome, 'restored')
    assert.match(result.reason, /operation-error/)
  })

  it('names both failures when the registry rollback fails too', async () => {
    const host = {
      async updateBundle() {
        return {
          from: '0.3.6', to: '0.3.7', step: 'install',
          result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'refused' } },
          restore: { application: 'failed', error: { code: 'operation-error', diagnostic: 'reinstall failed' } },
        }
      },
    }
    const result = await updateRegistry({ name: 'x', version: '0.3.7', host })
    assert.equal(result.outcome, 'failed')
    assert.match(result.reason, /refused/)
    assert.match(result.reason, /could not be restored/)
  })
})

describe('approved installs', () => {
  it('carries the user decision into the first attempt', async () => {
    await writeManifest()
    const seen = []
    const host = {
      async installBundle(spec, options) {
        seen.push(options?.approvedBuilds)
        return { application: 'applied', approvedBuilds: options?.approvedBuilds }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      initialApproval: [KEY],
    })
    assert.equal(result.outcome, 'updated')
    assert.deepEqual(seen, [[KEY]])
    assert.deepEqual(result.approvedBuilds, [KEY])
  })

  it('removes and retries when an approved replay is refused as installed', async () => {
    await writeManifest()
    const calls = []
    const host = {
      async removeBundle() { calls.push('remove'); return { application: 'applied' } },
      async installBundle(spec, options) {
        calls.push(options?.approvedBuilds === undefined ? 'install' : 'install-approved')
        if (calls.length === 1) {
          return { application: 'failed', stage: 'install', error: { code: 'already-installed' } }
        }
        return { application: 'applied', approvedBuilds: options?.approvedBuilds }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      decideApproval: async () => ({ decision: 'approve', keys: [KEY] }),
      approveBuilds: async (keys, spec) => ({
        application: 'failed', stage: 'install', error: { code: 'already-installed' },
      }),
    })
    assert.equal(result.outcome, 'updated')
    assert.deepEqual(calls, ['install', 'remove', 'install'])
  })

  it('cancels before replaying an approval', async () => {
    await writeManifest()
    const controller = new AbortController()
    const host = {
      async installBundle() {
        controller.abort()
        return { application: 'failed', stage: 'install', error: { code: 'operation-error', diagnostic: 'build blocked' }, pendingBuilds: [KEY] }
      },
    }
    let replayed = false
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      signal: controller.signal,
      decideApproval: async () => ({ decision: 'approve', keys: [KEY] }),
      approveBuilds: async () => { replayed = true; return { application: 'applied' } },
    })
    assert.equal(result.outcome, 'cancelled')
    assert.equal(replayed, false)
    assert.equal(await savedValue(), SAVED)
  })
})

describe('registry selection', () => {
  it('passes an explicit null registry to the host', async () => {
    let seen
    const host = {
      async updateBundle(name, version, options) {
        seen = options
        return { result: { application: 'applied' } }
      },
    }
    await updateRegistry({ name: 'x', version: '2.0.0', registry: null, host })
    assert.deepEqual(seen, { registry: null })
  })

  it('passes an empty request when there is neither a request id nor a registry', async () => {
    let seen = 'unset'
    const host = { async updateBundle(name, version, options) { seen = options; return { result: { application: 'applied' } } } }
    await updateRegistry({ name: 'x', version: '2.0.0', host })
    assert.equal(seen, undefined)
  })
})
