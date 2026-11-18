import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkRegistry } from '../src/detect.js'
import { runCheck } from '../src/check.js'

/**
 * A version listing the host returns.
 * @param {object[]} versions Newer versions, newest first.
 * @param {object} [extra] Extra listing fields.
 * @returns {object} The listing.
 */
function listing(versions, extra = {}) {
  return { status: 'listed', installed: '1.0.0', versions, ...extra }
}

/**
 * One registry candidate.
 * @param {string} name Package name.
 * @returns {object} The candidate.
 */
function candidate(name) {
  return { name, version: '1.0.0', parsed: { kind: 'registry' } }
}

describe('checkRegistry', () => {
  it('offers the newest version that declares a bundle and is compatible', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([
        { version: '2.0.0', bundle: true, incompatible: { name: 'x' } },
        { version: '1.5.0', bundle: true },
      ]),
    })
    assert.equal(state.state, 'update')
    assert.equal(state.identity.available, '1.5.0')
  })

  it('skips a newer version that declares no bundle', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([
        { version: '2.0.0', bundle: false },
        { version: '1.1.0', bundle: true },
      ]),
    })
    assert.equal(state.state, 'update')
    assert.equal(state.identity.available, '1.1.0')
  })

  it('reports blocked when every newer version is incompatible', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([
        { version: '2.0.0', bundle: true, incompatible: { name: 'x' } },
        { version: '1.5.0', bundle: true, incompatible: { name: 'x' } },
      ]),
    })
    assert.equal(state.state, 'blocked')
    assert.equal(state.installed, '1.0.0')
    assert.match(state.reason, /compatible/)
  })

  it('reports blocked when no newer version declares a bundle', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([{ version: '2.0.0', bundle: false }]),
    })
    assert.equal(state.state, 'blocked')
    assert.match(state.reason, /installable/)
  })

  it('qualifies the reason when the host omitted versions', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => ({
        status: 'listed', installed: '1.0.0', omitted: 2,
        versions: [{ version: '2.0.0', bundle: true, incompatible: { name: 'x' } }],
      }),
    })
    assert.match(state.reason, /2 newer versions not listed here/)
  })

  it('reports no update when nothing is newer', async () => {
    const state = await checkRegistry({ name: 'x', installed: '1.0.0', listVersions: async () => listing([]) })
    assert.equal(state.state, 'current')
  })

  it('carries the answering registry on the update identity', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([{ version: '2.0.0', bundle: true }], { registry: 'https://registry.example/' }),
    })
    assert.equal(state.state, 'update')
    assert.equal(state.identity.registry, 'https://registry.example/')
  })

  it('preserves an explicit null registry, which asks pnpm its own', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([{ version: '2.0.0', bundle: true }], { registry: null }),
    })
    assert.equal(state.identity.registry, null)
  })

  it('omits the registry when the listing names none', async () => {
    const state = await checkRegistry({
      name: 'x',
      installed: '1.0.0',
      listVersions: async () => listing([{ version: '2.0.0', bundle: true }]),
    })
    assert.equal('registry' in state.identity, false)
  })
})

describe('runCheck blocked reporting', () => {
  it('collects a blocked candidate without counting it as pending work', async () => {
    const result = await runCheck({
      candidates: [candidate('x')],
      commits: new Map(),
      cache: /** @type {object} */ ({}),
      listVersions: async () => listing([{ version: '2.0.0', bundle: true, incompatible: { name: 'x' } }]),
    })
    assert.deepEqual(result.updates, [])
    assert.deepEqual(result.unchecked, [])
    assert.deepEqual(result.blocked.map((entry) => [entry.name, entry.state]), [['x', 'blocked']])
    assert.equal(result.total, 0)
  })
})

describe('the snapshot keeps a blocked candidate', () => {
  it('survives the snapshot codec with its reason', async () => {
    const { remote } = await import('../src/remote.js')
    const descriptor = remote.descriptors.find((entry) => entry.method === 'snapshot')
    const schema = descriptor.result.create()
    const parsed = schema.parse({
      updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
      blocked: [{
        name: 'dsh-subscriptions', kind: 'registry', installed: '0.3.6',
        reason: 'no published version is compatible with this DeepSeek Harness',
      }],
    })
    assert.equal(parsed.blocked[0].name, 'dsh-subscriptions')
    assert.match(parsed.blocked[0].reason, /compatible/)
  })
})
