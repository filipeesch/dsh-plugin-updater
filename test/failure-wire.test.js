import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

const NAME = 'dsh-kanban'
const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const SAVED = 'github:filipeesch/deepseek-harness-kanban'
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

/** @type {string} */
let profileDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-failure-wire-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }, undefined, 2) + '\n')
})
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * A service whose git candidate removes and then fails both installs.
 * @returns {object} The service.
 */
function service() {
  let calls = 0
  const target = new UpdaterService({
    profileDir,
    pluginManager: {
      async listBundles() { return [] },
      async removeBundle() { return { application: 'applied' } },
      async installBundle() {
        calls += 1
        if (calls === 1) return { application: 'failed', stage: 'install', error: { code: 'already-installed' } }
        return { application: 'failed', stage: 'install', error: { code: 'operation-error', diagnostic: 'pnpm failed' } }
      },
    },
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
  target.lastCheck = {
    candidates: [{ name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED }],
    updates: [{
      name: NAME, kind: 'git', state: 'update', installed: '0.34.0',
      identity: { kind: 'version', commit: NEW, available: '0.35.0' },
    }],
    reloads: [], blocked: [], unchecked: [], ignored: [], total: 1,
  }
  return target
}

describe('a failed recovery reaches the browser', () => {
  it('carries the recovery diagnosis and the guidance through the wire', async () => {
    const result = await service().updateOne({ name: NAME })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.step, 'restore')
    assert.equal(result.failure.diagnostic, 'pnpm failed')
    assert.equal(result.failure.recovery.code, 'operation-error')
    assert.equal(result.failure.recovery.diagnostic, 'pnpm failed')
    assert.match(result.failure.reason, /could not restore/)
    assert.match(result.failure.reason, /reinstall .*#/)
    // The recovery spec is the way back; it must survive the projection.
    assert.equal(JSON.stringify(result).includes('approvedBuilds'), false)
  })
})
