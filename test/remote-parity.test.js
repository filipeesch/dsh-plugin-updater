import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZOD_REQUIRED, loadBundle } from './helpers/bundle.js'

/**
 * The host half's wire face.
 * @returns {Promise<object|undefined>} The module, or undefined without zod.
 */
async function hostFace() {
  try {
    return await import('../src/remote.js')
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
}

describe('wire face parity', () => {
  it('declares the same methods, parameters, and result types as src/remote.js', ZOD_REQUIRED, async () => {
    const host = await hostFace()
    if (host === undefined) return
    const bundled = loadBundle().exports.get('dsh-plugin-updater/remote').remote
    const byMethod = (face) => new Map(face.descriptors.map((descriptor) => [descriptor.method, descriptor]))
    const bundledMethods = byMethod(bundled)
    const hostMethods = byMethod(host.remote)
    assert.deepEqual([...bundledMethods.keys()].sort(), [...hostMethods.keys()].sort())
    for (const [method, descriptor] of bundledMethods) {
      const other = hostMethods.get(method)
      assert.equal(
        JSON.stringify(descriptor.parameters.map((parameter) => parameter.wire)),
        JSON.stringify(other.parameters.map((parameter) => parameter.wire)),
        method + ' parameters',
      )
      assert.equal(
        JSON.stringify(descriptor.input({ strict: true }).jsonSchema),
        JSON.stringify(other.input({ strict: true }).jsonSchema),
        method + ' request schema',
      )
      assert.equal(descriptor.result.typeSymbol, other.result.typeSymbol, method + ' result')
      assert.equal(
        JSON.stringify(descriptor.result.jsonSchema ?? null),
        JSON.stringify(other.result.jsonSchema ?? null),
        method + ' result schema',
      )
    }
  })

  it('carries the run and approval fields on the snapshot', ZOD_REQUIRED, async () => {
    const host = await hostFace()
    if (host === undefined) return
    const descriptor = host.remote.descriptors.find((entry) => entry.method === 'snapshot')
    const fields = descriptor.result.create().shape
    assert.ok('run' in fields)
    assert.ok('approvals' in fields)
    assert.equal('proposedRepositories' in fields, false)
  })

  it('refuses a build decision that carries client-supplied keys', ZOD_REQUIRED, async () => {
    const host = await hostFace()
    if (host === undefined) return
    const descriptor = host.remote.descriptors.find((entry) => entry.method === 'decideBuild')
    const schema = descriptor.input({ strict: true }).create()
    assert.equal(schema.safeParse({ request: { name: 'a', decision: 'allow' } }).success, true)
    assert.equal(schema.safeParse({ request: { name: 'a', decision: 'allow', keys: ['x'] } }).success, false)
    assert.equal(schema.safeParse({ request: { name: 'a', decision: 'maybe' } }).success, false)
  })
})
