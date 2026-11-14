import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { updateGit } from '../src/apply.js'

/**
 * The host resolves a failed change instead of throwing it.
 *
 * `PluginManager.change()` catches the failure and records it in `application`,
 * so a settled promise is not evidence of success. These tests use the resolved
 * shape the real host produces, which is why the earlier suite missed this.
 */

const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a39fef73ff6b885c2f39ccef86dcd75559405048'
const NEW = '7bfa1f9694b3d0aa0000000000000000000000ab'

/** @type {string} */
let profileDir

before(async () => { profileDir = await mkdtemp(join(tmpdir(), 'updater-resolved-')) })
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * @param {string} value Saved dependency.
 * @returns {Promise<void>}
 */
async function writeManifest(value) {
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'p', dependencies: { [NAME]: value } }, undefined, 2)}\n`)
}

/**
 * @returns {Promise<string>} The saved dependency value.
 */
async function savedValue() {
  return JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')).dependencies[NAME]
}

describe('a resolved failure is not success', () => {
  it('restores when the host resolves with application failed', async () => {
    await writeManifest(SAVED)
    const installed = []
    const host = {
      async removeBundle() { return { changed: true, application: 'applied', stage: 'remove', target: NAME } },
      async installBundle(spec) {
        installed.push(spec)
        // The real host resolves this; it does not reject.
        return spec.endsWith(`#${NEW}`)
          ? { changed: false, application: 'failed', stage: 'install', target: spec, error: { code: 'operation-error' } }
          : { changed: true, application: 'applied', stage: 'install', target: spec }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'restored')
    // The previous commit was reinstalled.
    assert.ok(installed.at(-1).endsWith(`#${OLD}`))
    assert.equal(await savedValue(), SAVED)
  })

  it('does not report updated when the host resolves with application cancelled', async () => {
    await writeManifest(SAVED)
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        return spec.endsWith(`#${NEW}`)
          ? { application: 'cancelled', stage: 'install' }
          : { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.notEqual(result.outcome, 'updated')
    assert.equal(await savedValue(), SAVED)
  })

  it('reports updated only for an applied installation', async () => {
    await writeManifest(SAVED)
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle() { return { changed: true, application: 'applied', stage: 'install' } },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'updated')
    assert.equal(await savedValue(), SAVED)
  })

  it('reports updated for a restart-requiring application', async () => {
    await writeManifest(SAVED)
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle() { return { changed: true, application: 'restart-required', stage: 'install', restartReason: 'no-hmr' } },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'updated')
  })
})
