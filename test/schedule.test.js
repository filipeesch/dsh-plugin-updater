import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHECK_INTERVAL_MS, CheckScheduler } from '../src/schedule.js'

describe('CHECK_INTERVAL_MS', () => {
  it('is one hour', () => {
    assert.equal(CHECK_INTERVAL_MS, 3_600_000)
  })
})

describe('CheckScheduler', () => {
  it('runs a check and reports the result', async () => {
    const states = []
    const scheduler = new CheckScheduler({
      check: async () => ({ total: 3 }),
      onStateChange: (state) => states.push(state),
    })
    const result = await scheduler.run('manual')
    assert.equal(result.total, 3)
    assert.equal(states.at(0).running, true)
    assert.equal(states.at(-1).running, false)
    assert.equal(states.at(-1).current, true)
  })

  it('coalesces a concurrent request', async () => {
    let calls = 0
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const scheduler = new CheckScheduler({
      check: async () => { calls += 1; await gate; return { total: 0 } },
    })
    const first = scheduler.run('startup')
    const second = await scheduler.run('manual')
    assert.equal(second, null)
    release()
    await first
    assert.equal(calls, 1)
  })

  it('keeps the previous result and marks it not current on failure', async () => {
    let attempt = 0
    const states = []
    const scheduler = new CheckScheduler({
      check: async () => {
        attempt += 1
        if (attempt === 1) return { total: 2 }
        throw new Error('network down')
      },
      onStateChange: (state) => states.push(state),
    })
    await scheduler.run('startup')
    await assert.rejects(() => scheduler.run('interval'), /network down/)
    const last = states.at(-1)
    assert.equal(last.current, false)
    assert.equal(last.failure, 'network down')
    assert.equal(last.lastResult.total, 2)
  })

  it('reports running state', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const scheduler = new CheckScheduler({ check: async () => { await gate; return {} } })
    const pending = scheduler.run('manual')
    assert.equal(scheduler.isRunning(), true)
    release()
    await pending
    assert.equal(scheduler.isRunning(), false)
  })

  it('starts and stops the interval', () => {
    const scheduler = new CheckScheduler({ check: async () => ({}) })
    scheduler.start()
    scheduler.stop()
    // Stopping twice is harmless.
    scheduler.stop()
  })
})
