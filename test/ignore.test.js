import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ignoreIdentity, isIgnored, normaliseIgnored } from '../src/ignore.js'

describe('ignoreIdentity', () => {
  it('uses the commit for git', () => {
    assert.equal(ignoreIdentity({ kind: 'git', commit: '7BFA1F9' }), '7bfa1f9')
  })

  it('uses the version for registry', () => {
    assert.equal(ignoreIdentity({ kind: 'registry', version: '0.35.0' }), '0.35.0')
  })

  it('has no identity for local or incomplete updates', () => {
    assert.equal(ignoreIdentity({ kind: 'local' }), undefined)
    assert.equal(ignoreIdentity({ kind: 'git' }), undefined)
  })
})

describe('isIgnored', () => {
  it('matches an ignored commit', () => {
    const ignored = [{ name: 'dsh-kanban', identity: '7bfa1f9' }]
    assert.equal(isIgnored({ name: 'dsh-kanban', kind: 'git', commit: '7bfa1f9' }, ignored), true)
  })

  it('reports a new commit even with the ignored version', () => {
    const ignored = [{ name: 'dsh-kanban', identity: '7bfa1f9' }]
    assert.equal(isIgnored({ name: 'dsh-kanban', kind: 'git', commit: 'aaaaaaa', version: '0.35.0' }, ignored), false)
  })

  it('matches an ignored version', () => {
    const ignored = [{ name: 'dsh-codex', identity: '0.3.4' }]
    assert.equal(isIgnored({ name: 'dsh-codex', kind: 'registry', version: '0.3.4' }, ignored), true)
  })

  it('reports a newer version after an ignored one', () => {
    const ignored = [{ name: 'dsh-codex', identity: '0.3.4' }]
    assert.equal(isIgnored({ name: 'dsh-codex', kind: 'registry', version: '0.3.5' }, ignored), false)
  })

  it('does not match another candidate with the same identity', () => {
    const ignored = [{ name: 'a', identity: '7bfa1f9' }]
    assert.equal(isIgnored({ name: 'b', kind: 'git', commit: '7bfa1f9' }, ignored), false)
  })
})

describe('normaliseIgnored', () => {
  it('keeps only well-formed entries', () => {
    const value = [{ name: 'a', identity: '1' }, { name: '' , identity: '2' }, { identity: '3' }, 'nope', null]
    assert.deepEqual(normaliseIgnored(value), [{ name: 'a', identity: '1' }])
  })

  it('handles a non-array', () => {
    assert.deepEqual(normaliseIgnored(undefined), [])
  })
})

describe('the shipped ignore path', () => {
  // The mutators that used to live in ignore.js were reachable only from their
  // own test; the bundle edits the list inline before saving. This covers the
  // rule that actually ships: a candidate is excluded by name plus identity, and
  // an identity change brings it back.
  it('excludes the ignored commit but not a newer one', () => {
    const ignored = [{ name: 'dsh-kanban', identity: 'aaaaaaa' }]
    assert.equal(isIgnored({ name: 'dsh-kanban', kind: 'git', commit: 'aaaaaaa' }, ignored), true)
    assert.equal(isIgnored({ name: 'dsh-kanban', kind: 'git', commit: 'bbbbbbb' }, ignored), false)
  })

  it('excludes the ignored version but not a newer one', () => {
    const ignored = [{ name: 'dsh-codex', identity: '0.3.2' }]
    assert.equal(isIgnored({ name: 'dsh-codex', kind: 'registry', version: '0.3.2' }, ignored), true)
    assert.equal(isIgnored({ name: 'dsh-codex', kind: 'registry', version: '0.4.0' }, ignored), false)
  })

  it('does not ignore the same identity on another candidate', () => {
    const ignored = [{ name: 'dsh-kanban', identity: 'aaaaaaa' }]
    assert.equal(isIgnored({ name: 'other', kind: 'git', commit: 'aaaaaaa' }, ignored), false)
  })
})
