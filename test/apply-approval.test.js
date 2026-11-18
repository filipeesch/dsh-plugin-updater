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
  it('approves and installs without removing the running package', async () => {
    await writeManifest(SAVED)
    const calls = []
    const removals = []
    const host = {
      async removeBundle(name) { removals.push(name); return { application: 'applied' } },
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
    // The approval is recorded on the host log, not in the row.
    assert.equal('approved' in result, false)
    assert.deepEqual(removals, [])
    // Two attempts: the plain install that was blocked, then the approved one.
    assert.equal(calls.length, 2)
    assert.ok(calls.at(-1).spec.endsWith(`#${NEW}`))
    assert.equal(await savedValue(), SAVED)
  })

  it('asks without leaving the plugin missing', async () => {
    await writeManifest(SAVED)
    const removals = []
    const host = {
      async removeBundle(name) { removals.push(name); return { application: 'applied' } },
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
    assert.equal(result.step, 'install')
    assert.deepEqual(result.needsApproval, [KEY])
    // Nothing was removed, so nothing had to be reinstalled.
    assert.equal(result.restore, undefined)
    assert.deepEqual(removals, [])
    assert.equal(await savedValue(), SAVED)
  })

  it('does not approve when no decision maker is supplied', async () => {
    await writeManifest(SAVED)
    let attempts = 0
    const host = {
      async installBundle(spec) {
        attempts += 1
        if (spec.endsWith(`#${NEW}`)) throw new Error('build blocked')
        return { application: 'applied' }
      },
    }
    const result = await updateGit({
      name: NAME, repository: REPO, saved: SAVED, previousCommit: OLD, targetCommit: NEW, profileDir, host,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(attempts, 1)
  })

  it('does not run a sibling repository build script without asking', async () => {
    // The end-to-end proof of the security property: a user who trusted
    // o/safe must not have code from o/safe-but-malicious executed for them.
    await writeManifest(SAVED)
    const SHA = 'c'.repeat(40)
    const siblingKey = `sibling@https://codeload.github.com/filipeesch/deepseek-harness-kanban-malware/tar.gz/${SHA}`
    const approved = []
    const host = {
      async installBundle() {
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
