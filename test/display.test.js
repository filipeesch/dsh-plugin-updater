import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gitUpdateIdentity, needsAttention, registryUpdateIdentity, summariseBatch } from '../src/display.js'

describe('gitUpdateIdentity', () => {
  it('reports a version change when the version moved', () => {
    const identity = gitUpdateIdentity({
      installedVersion: '0.34.0', headVersion: '0.35.0', installedCommit: 'a39fef7', headCommit: '7bfa1f9', commitCount: 12,
    })
    assert.equal(identity.kind, 'version')
    assert.equal(identity.installed, '0.34.0')
    assert.equal(identity.available, '0.35.0')
    assert.equal(identity.commit, '7bfa1f9')
    assert.equal(identity.commits, 12)
  })

  it('reports a commit count when the version did not move', () => {
    const identity = gitUpdateIdentity({
      installedVersion: '0.35.0', headVersion: '0.35.0', installedCommit: 'a39fef7', headCommit: '7bfa1f9', commitCount: 3,
    })
    assert.equal(identity.kind, 'commits')
    assert.equal(identity.commits, 3)
    assert.equal(identity.commit, '7bfa1f9')
  })

  it('reports unknown when neither a version change nor a count is known', () => {
    const identity = gitUpdateIdentity({
      installedVersion: '0.35.0', headVersion: '0.35.0', installedCommit: 'a39fef7', headCommit: '7bfa1f9',
    })
    assert.equal(identity.kind, 'unknown')
    assert.equal(identity.commit, '7bfa1f9')
  })

  it('prefers a version change over a count', () => {
    const identity = gitUpdateIdentity({ installedVersion: '1.0.0', headVersion: '2.0.0', commitCount: 1 })
    assert.equal(identity.kind, 'version')
  })
})

describe('registryUpdateIdentity', () => {
  it('reports the version change', () => {
    assert.deepEqual(registryUpdateIdentity({ installed: '0.3.2', available: '0.3.4' }), {
      kind: 'version', installed: '0.3.2', available: '0.3.4',
    })
  })

  it('reports unknown when a side is missing', () => {
    assert.equal(registryUpdateIdentity({ installed: '0.3.2' }).kind, 'unknown')
  })
})

describe('summariseBatch', () => {
  it('counts each outcome', () => {
    const summary = summariseBatch([
      { outcome: 'updated' },
      { outcome: 'updated' },
      { outcome: 'needsApproval' },
      { outcome: 'restored' },
    ])
    assert.equal(summary.updated, 2)
    assert.equal(summary.needsApproval, 1)
    assert.equal(summary.restored, 1)
    assert.equal(summary.total, 4)
  })

  it('ignores an outcome it does not know', () => {
    const summary = summariseBatch([{ outcome: 'somethingElse' }])
    assert.equal(summary.failed, 0)
    assert.equal(summary.total, 1)
  })
})

describe('needsAttention', () => {
  it('is true for an approval request', () => {
    assert.equal(needsAttention({ needsApproval: 1 }), true)
  })

  it('is true for a failure', () => {
    assert.equal(needsAttention({ failed: 1 }), true)
  })

  it('is false for a clean result', () => {
    assert.equal(needsAttention({ updated: 3 }), false)
  })
})
