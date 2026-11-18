import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/** @type {string} */
let profileDir
/** @type {string} */
let cacheDir

const NAME = 'plugin-a'
const REPO = 'github.com/o/r'
const SAVED = 'github:o/r'
const OLD = 'a39fef73ff6b885c2f39ccef86dcd75559405048'
const NEW = '7bfa1f9694b3d0aa0000000000000000000000ab'
const KEY = 'plugin-a@https://codeload.github.com/o/r/tar.gz/' + NEW

/**
 * Write the profile manifest with the candidate installed.
 * @returns {Promise<void>}
 */
async function writeManifest() {
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'p',
    dependencies: { [NAME]: SAVED },
  }, undefined, 2) + '\n')
}

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-approval-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'updater-approval-cache-'))
})
after(async () => {
  await rm(profileDir, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})
beforeEach(writeManifest)

/**
 * A service with one git update and a host double that refuses the first
 * installation until its build scripts are approved.
 * @param {object} [options] Recording hooks.
 * @returns {object} The service and the double's calls.
 */
function service(options = {}) {
  const calls = []
  let raw = {}
  const target = new UpdaterService({
    profileDir, cacheDir,
    pluginManager: {
      async removeBundle(name) { calls.push(['remove', name]); return { application: 'applied' } },
      async installBundle(spec, received) {
        calls.push(['install', spec, received])
        if (received?.approvedBuilds === undefined) return { application: 'failed' }
        return { application: 'applied' }
      },
    },
    config: () => raw,
    writeConfig: async (next) => { calls.push(['config', next]); raw = next },
    emit: () => {},
  })
  target.lastCheck = {
    candidates: [{ name: NAME, version: '1.0.0', saved: SAVED, parsed: { kind: 'git', repository: REPO }, installedCommit: OLD }],
    updates: [{
      name: NAME, kind: 'git', installed: '1.0.0',
      identity: { kind: 'version', installed: '1.0.0', available: '2.0.0', commit: NEW },
    }],
    reloads: [], unchecked: [], ignored: [], total: 1,
  }
  target.noteApproval({ name: NAME, kind: 'git' }, target.lastCheck.updates[0], {
    outcome: 'needsApproval',
    needsApproval: [KEY],
  })
  return { target, calls, options }
}

describe('build approval retention', () => {
  it('exposes only the facts the decision needs', async () => {
    const { target } = service()
    assert.deepEqual((await target.snapshot()).approvals, [{
      name: NAME, repository: REPO, keys: [KEY], targetCommit: NEW,
    }])
  })

  it('keeps a request whose target commit moved', async () => {
    // The request names the commit the user was asked about; a moved HEAD does
    // not make that decision meaningless.
    const { target } = service()
    target.lastCheck.updates[0].identity.commit = 'ffffffffffffffffffffffffffffffffffffffff'
    target.pruneApprovals()
    assert.equal((await target.snapshot()).approvals.length, 1)
  })

  it('drops a request for a plugin that is no longer installed', async () => {
    const { target } = service()
    target.lastCheck.candidates = []
    target.pruneApprovals()
    assert.deepEqual((await target.snapshot()).approvals, [])
  })
})

describe('decideBuild', () => {
  it('declines without touching the profile', async () => {
    const { target, calls } = service()
    const result = await target.decideBuild({ name: NAME, decision: 'decline' })
    assert.deepEqual(result.snapshot.approvals, [])
    assert.deepEqual(calls, [])
  })

  it('allows with the retained keys and the retained target', async () => {
    const { target, calls } = service()
    const result = await target.decideBuild({ name: NAME, decision: 'allow' })
    assert.equal(result.result.outcome, 'updated')
    assert.deepEqual(result.snapshot.approvals, [])
    const installs = calls.filter((entry) => entry[0] === 'install')
    // The decision reaches the first attempt, so the already-authorised install
    // is not preceded by one the user rejected.
    assert.equal(installs.length, 1)
    assert.deepEqual(installs[0][2].approvedBuilds, [KEY])
    assert.match(installs[0][2].requestId, /^updater:plugin-a:/)
    assert.ok(installs[0][1].endsWith('#' + NEW))
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies[NAME], SAVED)
  })

  it('always-allow trusts the repository first', async () => {
    const { target, calls } = service()
    const result = await target.decideBuild({ name: NAME, decision: 'always-allow' })
    assert.equal(result.result.outcome, 'updated')
    const configWrite = calls.find((entry) => entry[0] === 'config')
    assert.deepEqual(configWrite[1].trustedRepositories, [REPO])
    assert.equal(result.snapshot.trustedRepositories.includes(REPO), true)
  })

  it('refuses an unknown decision', async () => {
    const { target } = service()
    await assert.rejects(() => target.decideBuild({ name: NAME, decision: 'maybe' }), /needs a decision/)
  })

  it('refuses a candidate without a pending request', async () => {
    const { target } = service()
    await assert.rejects(() => target.decideBuild({ name: 'other', decision: 'allow' }), /no pending build approval/)
  })
})
