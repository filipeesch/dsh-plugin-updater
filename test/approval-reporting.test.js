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
  profileDir = await mkdtemp(join(tmpdir(), 'updater-approval-log-'))
  // A readable manifest keeps the check after the update from logging a second
  // line, so the test sees only the approval.
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }, undefined, 2) + '\n')
})
after(async () => { await rm(profileDir, { recursive: true, force: true }) })

/**
 * A service with one git candidate whose build script needs approval.
 * @param {string[]} lines The host log lines.
 * @returns {object} The service.
 */
function service(lines) {
  let attempts = 0
  return new UpdaterService({
    profileDir,
    pluginManager: {
      async listBundles() { return [] },
      async removeBundle() { return { application: 'applied' } },
      async installBundle(spec, options) {
        attempts += 1
        if (options?.approvedBuilds === undefined) {
          throw Object.assign(new Error('build blocked'), { pendingBuilds: [KEY] })
        }
        return { application: 'applied', approvedBuilds: options.approvedBuilds, attempts }
      },
    },
    config: () => ({ trustedRepositories: [REPO] }),
    writeConfig: async () => {},
    emit: () => {},
    log: { info: (message) => lines.push(String(message)) },
  })
}

/**
 * The one candidate the service has checked.
 * @param {object} target The service.
 * @returns {void}
 */
function ready(target) {
  target.lastCheck = {
    candidates: [{ name: NAME, parsed: { kind: 'git', repository: REPO }, version: '0.34.0', installedCommit: OLD, saved: SAVED }],
    updates: [{
      name: NAME, kind: 'git', state: 'update', installed: '0.34.0',
      identity: { kind: 'version', commit: NEW, available: '0.35.0' },
    }],
    reloads: [], blocked: [], unchecked: [], ignored: [], total: 1,
  }
}

describe('approval reporting', () => {
  it('logs the approval instead of sending the entries to the browser', async () => {
    const lines = []
    const target = service(lines)
    ready(target)
    const result = await target.updateOne({ name: NAME })
    assert.equal(result.outcome, 'updated')
    assert.equal('approved' in result, false)
    assert.equal(JSON.stringify(result).includes('approvedBuilds'), false)
    assert.equal(JSON.stringify(await target.snapshot()).includes('approvedBuilds'), false)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /approved build scripts/)
    assert.equal(lines[0].includes(REPO), true)
    assert.equal(lines[0].includes(KEY), true)
  })

  it('falls back to the warn level when the host logger has no info', async () => {
    const lines = []
    const target = new UpdaterService({
      profileDir,
      pluginManager: {
        async listBundles() { return [] },
        async installBundle(spec, options) {
          if (options?.approvedBuilds === undefined) {
            throw Object.assign(new Error('build blocked'), { pendingBuilds: [KEY] })
          }
          return { application: 'applied', approvedBuilds: options.approvedBuilds }
        },
      },
      config: () => ({ trustedRepositories: [REPO] }),
      writeConfig: async () => {},
      emit: () => {},
      log: { warn: (message) => lines.push(String(message)) },
    })
    ready(target)
    await target.updateOne({ name: NAME })
    assert.equal(lines.length, 1)
    assert.match(lines[0], /approved build scripts/)
  })
})
