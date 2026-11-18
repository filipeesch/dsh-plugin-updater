import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/** @type {string} */
let profileDir
/** @type {string} */
let cacheDir

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-run-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'updater-run-cache-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }, undefined, 2) + '\n')
})
after(async () => {
  await rm(profileDir, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

/**
 * A service with the given registry updates ready.
 * @param {object} pluginManager Host double.
 * @param {object[]} updates Updates to offer.
 * @returns {object} The service.
 */
function service(pluginManager, updates) {
  const target = new UpdaterService({
    profileDir, cacheDir, pluginManager,
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
  target.lastCheck = {
    candidates: updates.map((entry) => ({
      name: entry.name, version: entry.installed ?? '1.0.0', saved: '^1.0.0', parsed: { kind: 'registry', range: '^1.0.0' },
    })),
    updates,
    reloads: [],
    unchecked: [],
    ignored: [],
    total: updates.length,
  }
  return target
}

/**
 * One registry update.
 * @param {string} name Candidate name.
 * @returns {object} The checked state.
 */
function update(name) {
  return { name, kind: 'registry', installed: '1.0.0', identity: { kind: 'version', installed: '1.0.0', available: '2.0.0' } }
}

describe('run record', () => {
  it('is absent while nothing runs', async () => {
    const target = service({}, [update('a')])
    assert.equal((await target.snapshot()).run, undefined)
  })

  it('names the candidate, step, and request of a single update', async () => {
    const requests = []
    let captured
    const target = service({
      async updateBundle(name, version, options) {
        requests.push(options)
        captured = await target.snapshot()
        return { result: { application: 'applied' } }
      },
    }, [update('a')])
    const result = await target.updateOne({ name: 'a' })
    assert.equal(result.outcome, 'updated')
    assert.equal(captured.run.current.name, 'a')
    assert.equal(captured.run.current.step, 'installing')
    assert.match(captured.run.current.requestId, /^updater:a:/)
    assert.equal(requests[0].requestId, captured.run.current.requestId)
    assert.equal((await target.snapshot()).run, undefined)
    // A single update brings the check up to date, as a batch does.
    assert.equal(target.lastCheck.updates.some((entry) => entry.name === 'a'), false)
  })

  it('records a restart nested by the registry path', async () => {
    const target = service({}, [update('a')])
    target.noteRestart('a', { outcome: 'updated', result: { result: { application: 'restart-required' } } })
    assert.equal(JSON.stringify((await target.snapshot()).restartRequired), JSON.stringify(['a']))
  })

  it('passes the registry that answered the listing to the update', async () => {
    let seen
    const target = service({
      async updateBundle(name, version, options) {
        seen = options
        return { result: { application: 'applied' } }
      },
    }, [{
      name: 'a', kind: 'registry', installed: '1.0.0',
      identity: { kind: 'version', installed: '1.0.0', available: '2.0.0', registry: 'https://registry.example/' },
    }])
    await target.updateOne({ name: 'a' })
    assert.equal(seen.registry, 'https://registry.example/')
  })

  it('records the diagnosis of a failed candidate', async () => {
    const target = service({
      async updateBundle() {
        return { result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'ERR_PNPM_PEER_DEP_ISSUES' } } }
      },
    }, [update('a')])
    const result = await target.updateOne({ name: 'a' })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.failure.code, 'operation-error')
    assert.equal(result.failure.diagnostic, 'ERR_PNPM_PEER_DEP_ISSUES')
    assert.equal(result.failure.restored, false)
  })

  it('reports one candidate before the queue finishes', async () => {
    const seen = []
    const target = service({
      async updateBundle(name) {
        seen.push({ name, snapshot: await target.snapshot() })
        return { result: { application: 'applied' } }
      },
    }, [update('a'), update('b')])
    await target.updateAll()
    const duringSecond = seen.find((entry) => entry.name === 'b').snapshot
    assert.equal(duringSecond.run.current.name, 'b')
    assert.deepEqual(duringSecond.run.results.map((entry) => [entry.name, entry.outcome]), [['a', 'updated']])
  })
})
