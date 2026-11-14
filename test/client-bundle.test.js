import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { SEEDS, loadBundle, ZOD_REQUIRED } from './helpers/bundle.js'


describe('browser bundle', () => {
  it('registers both the panel and its wire face', ZOD_REQUIRED, () => {
    const { exports } = loadBundle()
    // The panel needs the face under the specifier it requires; the table strips
    // only a trailing /client, so the face needs its own id.
    assert.ok(exports.has('dsh-plugin-updater'))
    assert.ok(exports.has('dsh-plugin-updater/remote'))
  })

  it('asks only for specifiers the module table can serve', ZOD_REQUIRED, () => {
    const { requested } = loadBundle()
    for (const spec of requested) {
      assert.ok(
        SEEDS.has(spec) || spec === 'dsh-plugin-updater' || spec === 'dsh-plugin-updater/remote' || spec.startsWith('./'),
        `the table cannot serve ${spec}`,
      )
    }
  })

  it('returns an apply function and its injected services', ZOD_REQUIRED, () => {
    const { exports } = loadBundle()
    const panel = exports.get('dsh-plugin-updater')
    assert.equal(typeof panel.apply, 'function')
    assert.ok(panel.inject.includes('slots'))
    assert.ok(panel.inject.includes('remote'))
  })

  it('does not declare the namespace it mounts itself', ZOD_REQUIRED, () => {
    const { exports } = loadBundle()
    // Declaring it would park the fiber until the namespace resolves, and the
    // namespace only appears inside apply.
    assert.ok(!exports.get('dsh-plugin-updater').inject.includes('remote.pluginUpdater'))
  })

  it('exposes the wire face with the descriptors the host registers', ZOD_REQUIRED, () => {
    const { exports } = loadBundle()
    const face = exports.get('dsh-plugin-updater/remote')
    assert.equal(face.SERVICE_NAME, 'pluginUpdater')
    assert.equal(face.remote.descriptors.length, 7)
    assert.equal(face.host.invocations.length, 7)
  })

  it('registers the footer entry, the panel, and the notice when mounted', ZOD_REQUIRED, async () => {
    const { exports } = loadBundle()
    const panel = exports.get('dsh-plugin-updater')
    const registrations = []
    const ctx = {
      remote: {
        $mount: async () => async () => {},
        $on: () => () => {},
        pluginUpdater: {},
      },
      slots: {
        inject: (owner, factory) => { factory(); return () => {} },
        register: (options, component) => { registrations.push({ options, component }); return () => {} },
      },
      layout: { selectPanel: () => {} },
      locale: {},
    }
    ctx.inject = (_services, run) => {
      const handle = { dispose: async () => {} }
      Object.assign(handle, run({ ...ctx }))
      return handle
    }
    await panel.apply(ctx)
    const names = registrations.map((entry) => entry.options.name)
    assert.deepEqual(names, ['sidebar.footer.action', 'main', 'shell.overlay'])
    assert.ok(!names.includes('sidebar.panellist'))
  })

  it('mounts its wire face before the nested inject runs', ZOD_REQUIRED, async () => {
    const { exports } = loadBundle()
    const panel = exports.get('dsh-plugin-updater')
    const order = []
    const ctx = {
      remote: { $mount: async () => { order.push('mount'); return async () => {} }, $on: () => () => {}, pluginUpdater: {} },
      slots: { inject: () => { order.push('slot'); return () => {} }, register: () => () => {} },
      layout: { selectPanel: () => {} },
      locale: {},
    }
    ctx.inject = (_services, run) => {
      order.push('inject')
      const handle = { dispose: async () => {} }
      Object.assign(handle, run({ ...ctx }))
      return handle
    }
    await panel.apply(ctx)
    assert.deepEqual(order, ['mount', 'inject', 'slot', 'slot', 'slot'])
  })
})

describe('the pinned-spec warning survives the reload', () => {
  const bundle = () => loadBundle().exports.get('dsh-plugin-updater')

  it('is attached to the row when the row is rebuilt from the snapshot', ZOD_REQUIRED, () => {
    // This is the exact reload that erased it: rowsFromSnapshot rebuilt the row
    // from `updates[]`, which never carried the field, so the notice showed for
    // one frame and was replaced by a clean row.
    const rows = bundle().rowsFromSnapshot({
      updates: [{ name: 'dsh-kanban', kind: 'git', installed: '0.34.0', identity: { commit: 'bbbb' } }],
      reloads: [],
      unchecked: [],
      specRestoreFailed: [{ name: 'dsh-kanban', reason: 'could not write package.json' }],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].specRestoreFailed, 'could not write package.json')
  })

  it('does not mark an unaffected plugin', ZOD_REQUIRED, () => {
    const rows = bundle().rowsFromSnapshot({
      updates: [
        { name: 'a', kind: 'git', identity: {} },
        { name: 'b', kind: 'git', identity: {} },
      ],
      specRestoreFailed: [{ name: 'a', reason: 'disk full' }],
    })
    assert.equal(rows[0].specRestoreFailed, 'disk full')
    assert.equal(rows[1].specRestoreFailed, undefined)
  })

  it('marks a local reload and an unchecked candidate too', ZOD_REQUIRED, () => {
    const rows = bundle().rowsFromSnapshot({
      updates: [],
      reloads: [{ name: 'local-a', installed: '1.0.0' }],
      unchecked: [{ name: 'bad', kind: 'git', reason: 'unreachable' }],
      specRestoreFailed: [{ name: 'local-a', reason: 'x' }, { name: 'bad', reason: 'y' }],
    })
    assert.equal(rows[0].specRestoreFailed, 'x')
    assert.equal(rows[1].specRestoreFailed, 'y')
  })

  it('is absent from a snapshot that reports none', ZOD_REQUIRED, () => {
    const rows = bundle().rowsFromSnapshot({ updates: [{ name: 'a', kind: 'git', identity: {} }] })
    assert.equal(rows[0].specRestoreFailed, undefined)
  })

  it('counts it in the batch summary, which otherwise reads as a clean run', ZOD_REQUIRED, () => {
    // Without this count a batch that leaves a spec pinned says "2 updated" and
    // gives the user no reason to open the detail.
    const translate = (key, vars) => `${key}:${vars?.count ?? ''}`
    const summary = bundle().summaryNoticeOf([
      { outcome: 'updated', specRestoreFailed: 'could not write' },
      { outcome: 'updated' },
    ], 0, translate)
    assert.ok(summary.includes('summary.specRestoreFailed:1'), summary)
    assert.ok(summary.includes('summary.updated:2'), summary)
  })

  it('says nothing about it when no spec stayed pinned', ZOD_REQUIRED, () => {
    const translate = (key, vars) => `${key}:${vars?.count ?? ''}`
    const summary = bundle().summaryNoticeOf([{ outcome: 'updated' }], 0, translate)
    assert.ok(!summary.includes('summary.specRestoreFailed'), summary)
  })
})
