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
const KEY = `${NAME}@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/${NEW}`

/** @type {string} */
let profileDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-host-cancel-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }, undefined, 2) + '\n')
})
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * A service with one candidate already checked.
 * @param {object} pluginManager Host double.
 * @param {string} [kind] Candidate source.
 * @returns {object} The service.
 */
function service(pluginManager, kind = 'registry') {
  const target = new UpdaterService({
    profileDir, pluginManager,
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
  target.lastCheck = {
    candidates: kind === 'git'
      ? [{ name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED }]
      : [{ name: NAME, version: '1.0.0', saved: '^1.0.0', parsed: { kind: 'registry', range: '^1.0.0' } }],
    updates: kind === 'git'
      ? [{
        name: NAME, kind: 'git', state: 'update', installed: '0.34.0',
        identity: { kind: 'version', commit: NEW, available: '0.35.0' },
      }]
      : [{
        name: NAME, kind: 'registry', state: 'update', installed: '1.0.0',
        identity: { kind: 'version', installed: '1.0.0', available: '2.0.0' },
      }],
    reloads: [], blocked: [], unchecked: [], ignored: [], total: 1,
  }
  return target
}

/**
 * Wait one microtask turn so the update has started.
 * @returns {Promise<void>}
 */
function tick() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('host cancellation', () => {
  it('asks the host to cancel the running install', async () => {
    let cancelledWith
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const target = service({
      async listBundles() { return [] },
      async updateBundle() {
        await gate
        return { result: { application: 'cancelled' } }
      },
      async cancelInstall(requestId) {
        cancelledWith = requestId
        release()
        return { status: 'cancelled' }
      },
    })
    const running = target.updateOne({ name: NAME })
    await tick()
    const requestId = target.run.current.requestId
    assert.equal(target.cancel().cancelled, true)
    assert.equal(cancelledWith, requestId)
    const result = await running
    assert.equal(result.outcome, 'cancelled')
  })

  it('reports cancelled when the host reports no running request', async () => {
    const target = service({ async listBundles() { return [] } })
    assert.deepEqual(target.cancel(), { cancelled: false })
  })
})

describe('the wire projection', () => {
  it('sends no raw package result, host error, or approved entries', async () => {
    const target = service({
      async updateBundle() {
        return {
          from: '1.0.0', to: '2.0.0', step: 'install',
          result: {
            application: 'applied', changed: true, stage: 'install', target: 'x',
            packageResult: { output: 'pnpm output', exitCode: 0 },
            approvedBuilds: ['secret-key'],
          },
          restore: { application: 'applied', packageResult: { output: 'restore output' } },
        }
      },
    })
    const result = await target.updateOne({ name: NAME })
    const wire = JSON.stringify(result)
    assert.equal(wire.includes('secret-key'), false)
    assert.equal(wire.includes('packageResult'), false)
    assert.equal(wire.includes('"error"'), false)
    // The registry path keeps its nesting: the change sits under the update.
    assert.equal(result.result.result.application, 'applied')
    assert.equal(result.result.from, '1.0.0')
  })

  it('logs an approval the host persisted before a failed replay', async () => {
    const lines = []
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() { return [] },
        async installBundle(spec, options) {
          if (options?.approvedBuilds === undefined) {
            throw Object.assign(new Error('build blocked'), { pendingBuilds: [KEY] })
          }
          return {
            application: 'failed', stage: 'install',
            error: { code: 'operation-error', diagnostic: 'install failed' },
            approvedBuilds: options.approvedBuilds,
          }
        },
      },
      config: () => ({ trustedRepositories: [REPO] }),
      writeConfig: async () => {},
      emit: () => {},
      log: { info: (message) => lines.push(String(message)) },
    })
    target.lastCheck = {
      candidates: [{ name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED }],
      updates: [{
        name: NAME, kind: 'git', state: 'update', installed: '0.34.0',
        identity: { kind: 'version', commit: NEW, available: '0.35.0' },
      }],
      reloads: [], blocked: [], unchecked: [], ignored: [], total: 1,
    }
    const result = await target.updateOne({ name: NAME })
    assert.equal(result.outcome, 'failed')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].includes(KEY), true)
    assert.equal(JSON.stringify(result).includes('approvedBuilds'), false)
  })
})
