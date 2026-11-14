import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadBundle, ZOD_REQUIRED } from './helpers/bundle.js'

/**
 * A timer set the store can drive by hand.
 * @returns {object} The timer helpers.
 */
function timers() {
  const items = []
  return {
    schedule(fn, ms) {
      const item = { fn, ms, cancelled: false }
      items.push(item)
      return item
    },
    cancelSchedule(item) {
      if (item !== undefined) item.cancelled = true
    },
    async flush(maxMs = 1000) {
      const due = items.filter((item) => !item.cancelled && item.ms <= maxMs)
      for (const item of due) {
        item.cancelled = true
        await item.fn()
      }
      await new Promise((resolve) => setImmediate(resolve))
    },
    pending() {
      return items.filter((item) => !item.cancelled)
    },
  }
}

/**
 * An empty host snapshot.
 * @param {object} [over] Overrides.
 * @returns {object} The snapshot.
 */
function baseState(over = {}) {
  return {
    updates: [], reloads: [], unchecked: [], ignored: [], total: 0,
    checkedAt: 1000, current: true, restartRequired: [], specRestoreFailed: [],
    trustedRepositories: [], ignoredUpdates: [], approvals: [], ...over,
  }
}

/**
 * One registry update.
 * @param {string} name Candidate name.
 * @returns {object} The update.
 */
function update(name = 'a') {
  return {
    name, kind: 'registry', installed: '1.0.0',
    identity: { kind: 'version', installed: '1.0.0', available: '2.0.0' },
  }
}

/**
 * Build a store over a fake host.
 * @param {object} initial Initial snapshot.
 * @param {object} [handlers] Per-method overrides.
 * @param {boolean} [failSnapshot] Whether the snapshot call rejects.
 * @returns {object} The harness.
 */
function harness(initial, handlers = {}, failSnapshot = false) {
  const calls = []
  const events = {}
  let state = initial
  const remote = {
    pluginUpdater: {
      async snapshot() {
        calls.push({ name: 'snapshot' })
        if (failSnapshot) throw new Error('host offline')
        return state
      },
      async refresh() { calls.push({ name: 'refresh' }); return state },
      async updateOne(request) {
        calls.push({ name: 'updateOne', request })
        return handlers.updateOne === undefined ? { outcome: 'updated' } : await handlers.updateOne(request)
      },
      async updateAll() {
        calls.push({ name: 'updateAll' })
        return handlers.updateAll === undefined
          ? { results: [], cancelled: false, skippedIgnored: 0 }
          : await handlers.updateAll()
      },
      async recheck(request) {
        calls.push({ name: 'recheck', request })
        return handlers.recheck === undefined ? state : await handlers.recheck(request)
      },
      async trustRepository(request) { calls.push({ name: 'trustRepository', request }); return state },
      async decideBuild(request) {
        calls.push({ name: 'decideBuild', request })
        return handlers.decideBuild === undefined ? { snapshot: state } : await handlers.decideBuild(request)
      },
      async saveConfig(request) { calls.push({ name: 'saveConfig', request }); return state },
      async clearCache() { calls.push({ name: 'clearCache' }); return state },
      async cancel() { calls.push({ name: 'cancel' }); return { cancelled: true } },
    },
    $on(name, handler) {
      events[name] = handler
      return () => { delete events[name] }
    },
  }
  const clock = timers()
  const store = loadBundle().exports.get('dsh-plugin-updater').createStore({
    remote,
    layout: { selectPanel: (id) => { calls.push({ name: 'selectPanel', request: id }) } },
    translate: (key, vars) => (vars === undefined ? key : key + JSON.stringify(vars)),
    now: () => 1234,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
  })
  return {
    store,
    calls,
    events,
    timers: clock,
    setState(next) { state = next },
    count(name) { return calls.filter((entry) => entry.name === name).length },
  }
}

describe('store feedback', () => {
  it('keeps a completed row and a notice after the snapshot reload', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }))
    await h.store.actions.load()
    // The snapshot still lists the candidate while the host refreshes it, as a
    // single update does before the check completes.
    h.setState(baseState({ updates: [update()], total: 1 }))
    const pending = h.store.actions.updateOne('a')
    assert.equal(h.store.getSnapshot().rows[0].state, 'running')
    assert.equal(h.store.getSnapshot().busy, true)
    await pending
    assert.equal(h.store.getSnapshot().busy, false)
    const view = h.store.getSnapshot()
    assert.equal(view.rows.length, 1)
    assert.equal(view.rows[0].state, 'settled')
    assert.equal(view.rows[0].outcome, 'updated')
    assert.match(view.notice.text, /notice.updated/)
    assert.equal(view.total, 0)
    assert.equal(view.header.summary, 'header.current')
    assert.ok(h.count('snapshot') >= 2)
    assert.equal(h.count('refresh'), 0)
    h.store.actions.dismiss('a')
    assert.equal(h.store.getSnapshot().rows.length, 0)
    h.setState(baseState({
      updates: [{ ...update(), identity: { kind: 'version', installed: '1.0.0', available: '3.0.0' } }],
      total: 1,
    }))
    await h.store.actions.load()
    assert.equal(h.store.getSnapshot().rows.length, 1)
    assert.equal(h.store.getSnapshot().rows[0].available, '3.0.0')
  })

  it('does not dismiss a row with an undecided approval', ZOD_REQUIRED, async () => {
    const approval = { name: 'a', repository: 'github.com/o/r', keys: ['k'], targetCommit: 'c' }
    const h = harness(baseState({ updates: [update()], total: 1, approvals: [approval] }))
    await h.store.actions.load()
    h.store.actions.dismiss('a')
    const view = h.store.getSnapshot()
    assert.equal(view.rows.length, 1)
    assert.ok(view.rows[0].approval)
  })

  it('removes a dismissed failure from the count too', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }), {
      updateOne: async () => { throw new Error('boom') },
    })
    await h.store.actions.load()
    await h.store.actions.updateOne('a')
    assert.equal(h.store.getSnapshot().total, 1)
    h.store.actions.dismiss('a')
    assert.equal(h.store.getSnapshot().rows.length, 0)
    assert.equal(h.store.getSnapshot().total, 0)
  })

  it('does not claim current after a failed check', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [], total: 0, checkedAt: 1000, current: false, lastFailure: 'offline' }))
    await h.store.actions.load()
    const view = h.store.getSnapshot()
    assert.equal(view.current, false)
    assert.equal(view.header.summary, 'header.checkFailed')
    assert.match(view.header.notCurrent, /header.notCurrent/)
  })

  it('makes a startup or interval detection visible', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ running: true }))
    await h.store.actions.load()
    assert.equal(h.store.getSnapshot().checking, true)
    h.setState(baseState({ running: false }))
    await h.timers.flush(500)
    assert.equal(h.store.getSnapshot().checking, false)
  })

  it('dismisses a settled row without clearing the others', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update('a'), update('b')], total: 2 }))
    await h.store.actions.load()
    h.setState(baseState({ updates: [update('b')], total: 1 }))
    await h.store.actions.updateOne('a')
    assert.equal(h.store.getSnapshot().rows.length, 2)
    h.store.actions.dismiss('a')
    assert.equal(JSON.stringify(h.store.getSnapshot().rows.map((row) => row.name)), JSON.stringify(['b']))
  })

  it('clears settled rows when a manual check starts', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }))
    await h.store.actions.load()
    h.setState(baseState())
    await h.store.actions.updateOne('a')
    assert.equal(h.store.getSnapshot().rows.length, 1)
    h.setState(baseState())
    await h.store.actions.refresh()
    assert.equal(h.store.getSnapshot().rows.length, 0)
    assert.equal(h.count('refresh'), 1)
  })

  it('keeps an outstanding restart requirement from the snapshot', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ restartRequired: ['a'] }))
    await h.store.actions.load()
    assert.equal(JSON.stringify(h.store.getSnapshot().restartRequired), JSON.stringify(['a']))
  })

  it('keeps the notice when another snapshot is adopted', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }))
    await h.store.actions.load()
    h.setState(baseState())
    await h.store.actions.updateOne('a')
    const notice = h.store.getSnapshot().notice
    await h.store.actions.load()
    assert.deepEqual(h.store.getSnapshot().notice, notice)
  })
})

describe('store events', () => {
  it('reads the snapshot, not detection, on a manager change', ZOD_REQUIRED, async () => {
    const h = harness(baseState())
    await h.store.actions.load()
    const before = h.count('snapshot')
    h.events['plugin-manager/changed']({ reason: 'plugin' })
    await h.timers.flush(250)
    assert.equal(h.count('snapshot'), before + 1)
    assert.equal(h.count('refresh'), 0)
  })

  it('debounces several manager changes into one read', ZOD_REQUIRED, async () => {
    const h = harness(baseState())
    await h.store.actions.load()
    const before = h.count('snapshot')
    h.events['plugin-manager/changed']({ reason: 'plugin' })
    h.events['plugin-manager/changed']({ reason: 'plugin' })
    await h.timers.flush(100)
    assert.equal(h.count('snapshot'), before)
    await h.timers.flush(250)
    assert.equal(h.count('snapshot'), before + 1)
  })

  it('maps steps and streamed output to the running row', ZOD_REQUIRED, async () => {
    let release
    const h = harness(baseState({ updates: [update()], total: 1 }), {
      updateOne: () => new Promise((resolve) => { release = resolve }),
    })
    await h.store.actions.load()
    const pending = h.store.actions.updateOne('a')
    h.setState(baseState({
      updates: [update()],
      total: 1,
      run: { startedAt: 1, current: { name: 'a', step: 'removing', requestId: 'r1' }, results: [] },
    }))
    await h.timers.flush(500)
    assert.equal(h.store.getSnapshot().rows[0].step, 'removing')
    h.events['plugin-manager/install-state']({ requestId: 'r1', phase: 'installing' })
    assert.equal(h.store.getSnapshot().rows[0].step, 'installing')
    h.events['plugin-manager/install-log']({ requestId: 'r1', text: 'downloaded\n' })
    await h.timers.flush(100)
    assert.match(h.store.getSnapshot().rows[0].output.text, /downloaded/)
    h.setState(baseState())
    release({ outcome: 'updated' })
    await pending
    assert.match(h.store.getSnapshot().rows[0].output.text, /downloaded/)
    assert.equal(h.timers.pending().length, 0)
  })

  it('settles each batch item before the queue ends', ZOD_REQUIRED, async () => {
    let release
    const h = harness(baseState({ updates: [update('a'), update('b')], total: 2 }), {
      updateAll: () => new Promise((resolve) => { release = resolve }),
    })
    await h.store.actions.load()
    const pending = h.store.actions.updateAll()
    h.setState(baseState({
      updates: [update('a'), update('b')],
      total: 2,
      run: {
        startedAt: 1,
        current: { name: 'b', step: 'installing', requestId: 'r2' },
        results: [{ name: 'a', outcome: 'updated' }],
      },
    }))
    await h.timers.flush(500)
    const midway = h.store.getSnapshot().rows
    assert.equal(midway.find((row) => row.name === 'a').outcome, 'updated')
    assert.equal(midway.find((row) => row.name === 'b').state, 'running')
    h.setState(baseState())
    release({
      results: [
        { name: 'a', outcome: 'updated' },
        { name: 'b', outcome: 'updated' },
      ],
      cancelled: false,
      skippedIgnored: 0,
    })
    await pending
    const view = h.store.getSnapshot()
    assert.equal(JSON.stringify(view.rows.map((row) => row.outcome)), JSON.stringify(['updated', 'updated']))
    assert.match(view.notice.text, /summary.updated/)
  })
})

describe('store actions', () => {
  it('re-checks one candidate by name', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ unchecked: [{ name: 'bad', kind: 'registry', reason: 'down' }] }))
    await h.store.actions.load()
    await h.store.actions.recheck('bad')
    assert.equal(JSON.stringify(h.calls.find((entry) => entry.name === 'recheck').request), JSON.stringify({ name: 'bad' }))
  })

  it('trusts a candidate by name only', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }))
    await h.store.actions.load()
    await h.store.actions.trust('a')
    assert.equal(JSON.stringify(h.calls.find((entry) => entry.name === 'trustRepository').request), JSON.stringify({ name: 'a' }))
  })

  it('sends each build decision without keys', ZOD_REQUIRED, async () => {
    for (const decision of ['allow', 'always-allow', 'decline']) {
      const approval = { name: 'a', repository: 'github.com/o/r', keys: ['k'], targetCommit: 'c' }
      const h = harness(baseState({ updates: [update()], total: 1, approvals: [approval] }))
      await h.store.actions.load()
      await h.store.actions.decideBuild('a', decision)
      assert.equal(JSON.stringify(h.calls.find((entry) => entry.name === 'decideBuild').request), JSON.stringify({ name: 'a', decision }))
    }
  })

  it('settles the row after an allowed approval', ZOD_REQUIRED, async () => {
    const approval = { name: 'a', repository: 'github.com/o/r', keys: ['k'], targetCommit: 'c' }
    const h = harness(baseState({ updates: [update()], total: 1, approvals: [approval] }), {
      decideBuild: async () => ({
        snapshot: baseState({ updates: [update()], total: 1, approvals: [] }),
        result: { outcome: 'updated' },
      }),
    })
    await h.store.actions.load()
    await h.store.actions.decideBuild('a', 'allow')
    const view = h.store.getSnapshot()
    assert.equal(view.rows[0].state, 'settled')
    assert.equal(view.rows[0].outcome, 'updated')
    assert.match(view.notice.text, /notice.updated/)
    assert.equal(view.total, 0)
  })

  it('ignores a git update by its commit', ZOD_REQUIRED, async () => {
    const h = harness(baseState())
    await h.store.actions.ignore({ name: 'a', kind: 'git', commit: 'abc123' })
    assert.equal(JSON.stringify(h.calls.find((entry) => entry.name === 'saveConfig').request), JSON.stringify({
      ignoredUpdates: [{ name: 'a', identity: 'abc123' }],
    }))
  })

  it('opens the panel and reads the snapshot', ZOD_REQUIRED, async () => {
    const h = harness(baseState())
    h.store.actions.openPanel()
    await h.timers.flush(0)
    assert.equal(h.calls.find((entry) => entry.name === 'selectPanel').request, 'plugin-updater')
    assert.ok(h.count('snapshot') >= 1)
  })

  it('surfaces a failed call without clearing existing rows', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }), {}, true)
    await h.store.actions.load()
    const view = h.store.getSnapshot()
    assert.match(view.error, /error.generic/)
    assert.equal(view.rows.length, 0)
  })

  it('settles a failed update instead of leaving it running', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }), {
      updateOne: async () => { throw new Error('boom') },
    })
    await h.store.actions.load()
    await h.store.actions.updateOne('a')
    const view = h.store.getSnapshot()
    assert.equal(view.rows[0].state, 'failed')
    assert.equal(view.notice.tone, 'error')
    assert.equal(view.busy, false)
  })

  it('counts a mixed batch and keeps its failure visible', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update('a'), update('b')], total: 2 }), {
      updateAll: async () => ({
        results: [
          { name: 'a', outcome: 'updated' },
          { name: 'b', outcome: 'failed', result: { outcome: 'failed', reason: 'nope' } },
        ],
        cancelled: false,
        skippedIgnored: 0,
      }),
    })
    await h.store.actions.load()
    await h.store.actions.updateAll()
    const view = h.store.getSnapshot()
    assert.equal(JSON.stringify(view.rows.map((row) => row.outcome)), JSON.stringify(['updated', 'failed']))
    assert.equal(view.notice.tone, 'error')
    assert.match(view.notice.text, /summary.failed/)
  })

  it('carries the restart requirement on the notice that caused it', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }), {
      updateOne: async () => ({ outcome: 'updated', result: { result: { application: 'restart-required' } } }),
    })
    await h.store.actions.load()
    h.setState(baseState())
    await h.store.actions.updateOne('a')
    assert.equal(h.store.getSnapshot().notice.restart, true)
  })

  it('keeps a settled row across an automatic check', ZOD_REQUIRED, async () => {
    const h = harness(baseState({ updates: [update()], total: 1 }))
    await h.store.actions.load()
    h.setState(baseState())
    await h.store.actions.updateOne('a')
    h.events['plugin-manager/changed']({ reason: 'plugin' })
    await h.timers.flush(250)
    assert.equal(h.store.getSnapshot().rows.length, 1)
    assert.equal(h.store.getSnapshot().rows[0].state, 'settled')
  })

  it('locks the check controls while a retry runs', ZOD_REQUIRED, async () => {
    let release
    const h = harness(baseState({ unchecked: [{ name: 'bad', kind: 'registry', reason: 'down' }] }), {
      recheck: () => new Promise((resolve) => { release = resolve }),
    })
    await h.store.actions.load()
    const pending = h.store.actions.recheck('bad')
    assert.equal(h.store.getSnapshot().checking, true)
    release(baseState({ unchecked: [] }))
    await pending
    assert.equal(h.store.getSnapshot().checking, false)
  })

  it('cancels a running queue', ZOD_REQUIRED, async () => {
    const h = harness(baseState())
    await h.store.actions.cancel()
    assert.equal(h.count('cancel'), 1)
  })
})
