import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/**
 * The bridge needs `zod`, which this package resolves from the host profile it
 * runs inside. A checkout has no `node_modules`, so the contract checks that do
 * not need a descriptor are asserted here, and the descriptor checks run only
 * when `zod` resolves.
 * @returns {Promise<object|undefined>} The bridge, or undefined without `zod`.
 */
async function bridge() {
  try {
    return await import('../src/remote.js')
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
}

/**
 * A service with no profile or package manager.
 * @returns {object} The service.
 */
function service() {
  return new UpdaterService({
    profileDir: '/nonexistent',
    pluginManager: {},
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
}

describe('remote contract', () => {
  it('declares zod as a peer dependency, since it resolves from the host', async () => {
    const { readFileSync } = await import('node:fs')
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(typeof manifest.peerDependencies?.zod, 'string')
    // A bundled copy would drift from the host's; a peer cannot.
    assert.equal(manifest.dependencies, undefined)
  })

  it('implements every operation the bridge declares', async (t) => {
    const module = await bridge()
    if (module === undefined) {
      t.skip('zod is not installed in this checkout')
      return
    }
    const target = service()
    const missing = module.remote.descriptors
      .map((descriptor) => descriptor.method)
      .filter((method) => typeof target[method] !== 'function')
    assert.deepEqual(missing, [], `the service does not implement: ${missing.join(', ')}`)
  })

  it('addresses the service key the host provides', async (t) => {
    const module = await bridge()
    if (module === undefined) {
      t.skip('zod is not installed in this checkout')
      return
    }
    assert.equal(module.SERVICE_NAME, 'pluginUpdater')
    for (const descriptor of module.remote.descriptors) {
      assert.equal(descriptor.service, module.SERVICE_NAME)
    }
  })

  it('splits every endpoint into a namespace and a method', async (t) => {
    const module = await bridge()
    if (module === undefined) {
      t.skip('zod is not installed in this checkout')
      return
    }
    for (const descriptor of module.remote.descriptors) {
      assert.equal(descriptor.namespace, 'pluginUpdater')
      assert.ok(descriptor.method.length > 0)
      assert.equal(descriptor.id, `dsh-plugin-updater#${descriptor.namespace}/${descriptor.method}`)
    }
  })

  it('gives every descriptor a result codec and an input parser', async (t) => {
    const module = await bridge()
    if (module === undefined) {
      t.skip('zod is not installed in this checkout')
      return
    }
    for (const descriptor of module.remote.descriptors) {
      assert.equal(typeof descriptor.result.create, 'function', `${descriptor.id} has no result schema`)
      const schema = descriptor.input({ strict: true }).create()
      assert.equal(typeof schema.parse, 'function', `${descriptor.id} has no input parser`)
    }
  })
})

describe('cancel', () => {
  it('reports that nothing was running', () => {
    assert.deepEqual(service().cancel(), { cancelled: false })
  })

  it('aborts a running queue', () => {
    const target = service()
    const controller = new AbortController()
    target.cancellation = controller
    assert.deepEqual(target.cancel(), { cancelled: true })
    assert.equal(controller.signal.aborted, true)
  })
})
