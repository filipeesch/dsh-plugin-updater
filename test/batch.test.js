import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runBatch } from '../src/batch.js'

/** An item. */
const item = (name, kind) => ({ name, kind })

describe('runBatch', () => {
  it('runs every item in order', async () => {
    const seen = []
    const { results } = await runBatch({
      items: [item('a', 'git'), item('b', 'git')],
      run: async (entry) => { seen.push(entry.name); return { outcome: 'updated' } },
    })
    assert.deepEqual(seen, ['a', 'b'])
    assert.equal(results.length, 2)
  })

  it('continues after a failure', async () => {
    const seen = []
    const { results } = await runBatch({
      items: [item('a', 'git'), item('b', 'git'), item('c', 'git')],
      run: async (entry) => {
        seen.push(entry.name)
        return { outcome: entry.name === 'a' ? 'restored' : 'updated' }
      },
    })
    assert.deepEqual(seen, ['a', 'b', 'c'])
    assert.equal(results[0].outcome, 'restored')
    assert.equal(results[2].outcome, 'updated')
  })

  it('puts local reloads last', async () => {
    const seen = []
    await runBatch({
      items: [item('local', 'local'), item('git', 'git'), item('npm', 'registry')],
      run: async (entry) => { seen.push(entry.name); return { outcome: 'updated' } },
    })
    assert.deepEqual(seen, ['npm', 'git', 'local'])
  })

  it('abandons the queue when cancelled', async () => {
    const controller = new AbortController()
    const seen = []
    const { results, cancelled } = await runBatch({
      items: [item('a', 'git'), item('b', 'git')],
      run: async (entry) => {
        seen.push(entry.name)
        controller.abort()
        return { outcome: 'cancelled' }
      },
      signal: controller.signal,
    })
    assert.equal(cancelled, true)
    assert.deepEqual(seen, ['a'])
    assert.equal(results.length, 1)
  })

  it('reports each result', async () => {
    const reported = []
    await runBatch({
      items: [item('a', 'git')],
      run: async () => ({ outcome: 'updated' }),
      onResult: (name, result) => reported.push([name, result.outcome]),
    })
    assert.deepEqual(reported, [['a', 'updated']])
  })
})

describe('a throwing candidate does not abandon the queue', () => {
  // `runItem` throws on a missing repository, a missing target commit, a missing
  // target version, and updateGit can throw while restoring. The earlier case here
  // expressed failure as a RETURNED outcome, which is the easy shape of the
  // contract, not the one that occurs.
  const items = [
    { name: 'git-a', kind: 'git' },
    { name: 'git-b', kind: 'git' },
    { name: 'local-c', kind: 'local' },
  ]

  it('attempts every remaining item after one throws', async () => {
    const seen = []
    const { results } = await runBatch({
      items,
      run: async (item) => {
        seen.push(item.name)
        if (item.name === 'git-a') throw new Error('git-a has no target commit')
        return { outcome: 'updated' }
      },
    })
    assert.deepEqual(seen, ['git-a', 'git-b', 'local-c'])
    assert.equal(results.length, 3)
  })

  it('reports the throwing item as failed with its reason', async () => {
    const { results } = await runBatch({
      items,
      run: async (item) => {
        if (item.name === 'git-a') throw new Error('git-a has no target commit')
        return { outcome: 'updated' }
      },
    })
    assert.equal(results[0].outcome, 'failed')
    assert.match(results[0].result.reason, /no target commit/)
    assert.equal(results[1].outcome, 'updated')
    assert.equal(results[2].outcome, 'updated')
  })

  it('does not reject the whole batch', async () => {
    // The caller must be able to render the results it asked for.
    await assert.doesNotReject(() => runBatch({
      items,
      run: async () => { throw new Error('boom') },
    }))
  })

  it('reports each outcome, including the failure', async () => {
    const reported = []
    await runBatch({
      items,
      run: async (item) => {
        if (item.name === 'git-b') throw new Error('boom')
        return { outcome: 'updated' }
      },
      onResult: (name, result) => reported.push([name, result.outcome]),
    })
    assert.deepEqual(reported, [['git-a', 'updated'], ['git-b', 'failed'], ['local-c', 'updated']])
  })

  it('does not report a completed queue as cancelled', async () => {
    // A signal that fires as the LAST item finishes abandoned nothing: every
    // candidate was attempted, so reporting cancellation would be wrong.
    const controller = new AbortController()
    const { cancelled, results } = await runBatch({
      items,
      run: async (item) => {
        if (item.name === 'local-c') controller.abort()
        return { outcome: 'updated' }
      },
      signal: controller.signal,
    })
    assert.equal(results.length, 3)
    assert.equal(cancelled, false)
  })
})
