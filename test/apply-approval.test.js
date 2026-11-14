import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { updateGit } from '../src/apply.js'
import { decideBuildApproval } from '../src/approve.js'

const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a39fef73ff6b885c2f39ccef86dcd75559405048'
const NEW = '7bfa1f9694b3d0aa0000000000000000000000ab'
const KEY = `${NAME}@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/${NEW}`

/** @type {string} */
let profileDir

before(async () => { profileDir = await mkdtemp(join(tmpdir(), 'updater-approve-')) })
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * Write a profile manifest.
 * @param {string} value Saved dependency.
 * @returns {Promise<void>}
 */
async function writeManifest(value) {
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'p', dependencies: { [NAME]: value } }, undefined, 2)}\n`)
}

/**
 * The saved dependency value.
 * @returns {Promise<string>} The value.
 */
async function savedValue() {
  return JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')).dependencies[NAME]
}

describe('updateGit with build approval', () => {
  it('approves and installs for a trusted repository', async () => {
    await writeManifest(SAVED)
    const calls = []
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        calls.push({ spec })
        const error = new Error('build blocked')
        error.pendingBuilds = [KEY]
        throw error
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      decideApproval: async (failure) => ({ decision: 'approve', keys: failure.value.pendingBuilds }),
      approveBuilds: async (keys, spec) => {
        calls.push({ spec, options: { approvedBuilds: keys } })
        return { application: 'applied' }
      },
    })
    assert.equal(result.outcome, 'updated')
    assert.deepEqual(result.approved, [KEY])
    // Two attempts: the plain install that was blocked, then the approved one.
    assert.equal(calls.length, 2)
    assert.ok(calls.at(-1).spec.endsWith(`#${NEW}`))
    assert.equal(await savedValue(), SAVED)
  })

  it('restores and reports an approval request when the answer is ask', async () => {
    await writeManifest(SAVED)
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        if (spec.endsWith(`#${NEW}`)) throw new Error('build blocked')
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      decideApproval: async () => ({ decision: 'ask', keys: [KEY] }),
      approveBuilds: async () => ({ approvalRecorded: [] }),
    })
    assert.equal(result.outcome, 'needsApproval')
    assert.deepEqual(result.needsApproval, [KEY])
    // The plugin must not be left missing while a question is pending.
    assert.equal(result.restore.application, 'applied')
    assert.equal(await savedValue(), SAVED)
  })

  it('does not approve when no decision maker is supplied', async () => {
    await writeManifest(SAVED)
    let attempts = 0
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        attempts += 1
        if (spec.endsWith(`#${NEW}`)) throw new Error('build blocked')
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'restored')
    assert.equal(attempts, 2)
  })

  it('does not run a sibling repository build script without asking', async () => {
    // The end-to-end proof of the security property: a user who trusted
    // o/safe must not have code from o/safe-but-malicious executed for them.
    await writeManifest(SAVED)
    const SHA = 'c'.repeat(40)
    const siblingKey = `sibling@https://codeload.github.com/filipeesch/deepseek-harness-kanban-malware/tar.gz/${SHA}`
    const approved = []
    const host = {
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec) {
        const error = new Error('build blocked')
        error.pendingBuilds = [siblingKey]
        throw error
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
      decideApproval: async (failure) => decideBuildApproval({
        pendingBuilds: failure.value.pendingBuilds,
        repository: 'github.com/filipeesch/deepseek-harness-kanban-malware',
        trustedRepositories: [REPO],
      }),
      approveBuilds: async (keys) => { approved.push(...keys); return { application: 'applied' } },
    })
    assert.deepEqual(approved, [])
    assert.equal(result.outcome, 'needsApproval')
    assert.deepEqual(result.needsApproval, [siblingKey])
  })
})
