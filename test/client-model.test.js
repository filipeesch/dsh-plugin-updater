import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZOD_REQUIRED, loadBundle } from './helpers/bundle.js'

/** @returns {object} The bundle exports. */
function bundle() {
  return loadBundle().exports.get('dsh-plugin-updater')
}

/**
 * A translator that keeps the key visible.
 * @param {string} key Key.
 * @param {object} [vars] Values.
 * @returns {string} The key and its values.
 */
function translate(key, vars) {
  return vars === undefined ? key : key + '(' + JSON.stringify(vars) + ')'
}

/**
 * An empty session layer.
 * @param {object} [over] Overrides.
 * @returns {object} The session.
 */
function session(over = {}) {
  return {
    attempts: {}, dismissed: {}, rowCache: {}, batch: false,
    notice: undefined, error: undefined, announcement: '', ...over,
  }
}

const UPDATE = {
  name: 'dsh-kanban',
  kind: 'git',
  installed: '0.34.0',
  repository: 'github.com/o/r',
  identity: { available: '0.35.0', commits: 4, commit: 'bbbb' },
}

describe('rowsFromSnapshot', () => {
  it('marks a trusted repository and leaves another untrusted', () => {
    const rows = bundle().rowsFromSnapshot({
      updates: [UPDATE, { ...UPDATE, name: 'other', repository: 'github.com/x/y' }],
      trustedRepositories: ['github.com/o/r'],
    })
    assert.equal(rows[0].trusted, true)
    assert.equal(rows[1].trusted, false)
  })

  it('offers a retry for a failed check', () => {
    const rows = bundle().rowsFromSnapshot({
      unchecked: [{ name: 'bad', kind: 'git', reason: 'unreachable' }],
    })
    assert.equal(rows[0].action, 'retry')
    assert.equal(rows[0].state, 'failed-check')
  })
})

describe('rowsOf', () => {
  const base = [{ name: 'a', kind: 'registry', action: 'update', state: 'idle', installed: '1.0.0', trusted: false }]

  it('shows a running attempt with its step and output', () => {
    const rows = bundle().rowsOf(base, session({
      attempts: { a: { state: 'running', step: 'installing', row: base[0], output: { text: 'pnpm line', truncated: false } } },
    }), [], 'updating')
    assert.equal(rows[0].state, 'running')
    assert.equal(rows[0].step, 'installing')
    assert.equal(rows[0].output.text, 'pnpm line')
  })

  it('keeps a settled row whose candidate left the snapshot', () => {
    const rows = bundle().rowsOf([], session({
      attempts: { a: { state: 'settled', outcome: 'updated', row: base[0], output: { text: '', truncated: false } } },
    }), [], 'idle')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].outcome, 'updated')
    assert.equal(rows[0].state, 'settled')
  })

  it('filters the same offered update after it was dismissed', () => {
    const rows = bundle().rowsOf(base, session({
      dismissed: { a: 'v:1.0.0' },
      attempts: { a: { state: 'settled', outcome: 'updated', row: base[0] } },
    }), [], 'idle')
    assert.equal(rows.length, 0)
  })

  it('shows a different update for a name whose previous result was dismissed', () => {
    const rows = bundle().rowsOf(base, session({ dismissed: { a: 'v:0.9.0' } }), [], 'idle')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].state, 'idle')
  })

  it('attaches a pending approval to its row', () => {
    const approval = { name: 'a', repository: 'github.com/o/r', keys: ['k'], targetCommit: 'c' }
    const rows = bundle().rowsOf(base, session(), [approval], 'idle')
    assert.deepEqual(rows[0].approval, approval)
  })

  it('marks pending rows as queued during a batch', () => {
    const rows = bundle().rowsOf(base, session({ batch: true }), [], 'updating')
    assert.equal(rows[0].state, 'queued')
  })
})

describe('statusOf', () => {
  it('uses a warning tone for an approval request', () => {
    const status = bundle().statusOf({ state: 'settled', approval: { name: 'a' } }, translate)
    assert.equal(status.tone, 'warn')
  })

  it('uses an error tone for a failed outcome', () => {
    assert.equal(bundle().statusOf({ state: 'settled', outcome: 'failed' }, translate).tone, 'error')
  })

  it('uses a success tone for an update', () => {
    assert.equal(bundle().statusOf({ state: 'settled', outcome: 'updated' }, translate).tone, 'success')
  })

  it('has no badge for an idle row', () => {
    assert.equal(bundle().statusOf({ state: 'idle' }, translate), undefined)
  })
})

describe('versionLine', () => {
  it('shows the version change', () => {
    assert.equal(bundle().versionLine({ installed: '1.0.0', available: '2.0.0' }, translate), '1.0.0 \u2192 2.0.0')
  })

  it('shows a commit count when the version did not move', () => {
    assert.equal(bundle().versionLine({ installed: '1.0.0', commits: 4 }, translate), 'row.commits({"count":4})')
  })

  it('uses the singular label for one commit', () => {
    assert.equal(bundle().versionLine({ installed: '1.0.0', commits: 1 }, translate), 'row.commitOne')
  })
})

describe('headerOf', () => {
  it('counts one candidate in the singular', () => {
    const header = bundle().headerOf({ total: 1, checkedAt: 1000, current: true }, translate)
    assert.equal(header.summary, 'header.attentionOne')
  })

  it('counts several candidates in the plural', () => {
    const header = bundle().headerOf({ total: 3, checkedAt: 1000, current: true }, translate)
    assert.match(header.summary, /header.attention/)
  })

  it('states the last check and the failure', () => {
    const header = bundle().headerOf({ total: 0, checkedAt: 1000, current: false, lastFailure: 'offline' }, translate)
    assert.match(header.lastChecked, /header.lastChecked/)
    assert.match(header.notCurrent, /header.notCurrent/)
  })

  it('states an unknown state before the first check', () => {
    const header = bundle().headerOf({ total: 0, current: true }, translate)
    assert.equal(header.summary, 'header.unknown')
    assert.equal(header.lastChecked, undefined)
  })

  it('does not claim current after a failed check', () => {
    const header = bundle().headerOf({ total: 0, checkedAt: 1000, current: false, lastFailure: 'offline' }, translate)
    assert.equal(header.summary, 'header.checkFailed')
    assert.match(header.notCurrent, /header.notCurrent/)
  })

  it('counts a cancelled candidate in the batch summary', () => {
    const summary = bundle().summaryNoticeOf([
      { outcome: 'updated' },
      { outcome: 'cancelled' },
    ], 0, translate)
    assert.match(summary, /summary.updated/)
    assert.match(summary, /summary.cancelled/)
  })
})

describe('bundle exports', () => {
  it('exposes the pure model and the store factory', () => {
    const panel = bundle()
    assert.equal(typeof panel.createStore, 'function')
    assert.equal(typeof panel.rowsOf, 'function')
    assert.equal(typeof panel.rowsFromSnapshot, 'function')
    assert.equal(typeof panel.statusOf, 'function')
    assert.equal(typeof panel.headerOf, 'function')
  })
})
