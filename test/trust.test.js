import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addTrusted, isTrusted, normaliseTrusted, parseTrustedRepository, removeTrusted,
} from '../src/trust.js'

describe('parseTrustedRepository', () => {
  it('accepts a host and path', () => {
    assert.deepEqual(parseTrustedRepository('github.com/owner/repo'), { ok: true, repository: 'github.com/owner/repo' })
  })

  it('assumes github when the host is absent', () => {
    assert.deepEqual(parseTrustedRepository('owner/repo'), { ok: true, repository: 'github.com/owner/repo' })
  })

  it('accepts a full url and drops the protocol', () => {
    assert.deepEqual(parseTrustedRepository('https://github.com/owner/repo.git'), { ok: true, repository: 'github.com/owner/repo' })
  })

  it('accepts a shorthand', () => {
    assert.deepEqual(parseTrustedRepository('github:owner/repo'), { ok: true, repository: 'github.com/owner/repo' })
  })

  it('accepts an scp-like address', () => {
    assert.deepEqual(parseTrustedRepository('git@github.com:owner/repo.git'), { ok: true, repository: 'github.com/owner/repo' })
  })

  it('refuses a pattern', () => {
    assert.deepEqual(parseTrustedRepository('owner/*'), { ok: false, reason: 'pattern' })
    assert.deepEqual(parseTrustedRepository('github.com/owner/*'), { ok: false, reason: 'pattern' })
  })

  it('refuses an account with no repository', () => {
    const result = parseTrustedRepository('owner')
    assert.equal(result.ok, false)
  })

  it('refuses an empty value', () => {
    assert.deepEqual(parseTrustedRepository('  '), { ok: false, reason: 'empty' })
  })

  it('accepts a repository on a host other than GitHub', () => {
    // This plugin is not for one person's setup: a GitLab or self-hosted
    // repository is a repository like any other.
    assert.deepEqual(parseTrustedRepository('https://gitlab.com/owner/repo'), { ok: true, repository: 'gitlab.com/owner/repo' })
    assert.deepEqual(parseTrustedRepository('https://git.example.com/team/repo.git'), { ok: true, repository: 'git.example.com/team/repo' })
  })

  it('accepts a gitlab shorthand', () => {
    assert.deepEqual(parseTrustedRepository('gitlab:owner/repo'), { ok: true, repository: 'gitlab.com/owner/repo' })
  })

  it('accepts a GitLab subgroup path as one repository', () => {
    // Nested groups are normal on GitLab; each is still a single project.
    assert.deepEqual(parseTrustedRepository('https://gitlab.com/group/subgroup/repo'), {
      ok: true, repository: 'gitlab.com/group/subgroup/repo',
    })
    assert.deepEqual(parseTrustedRepository('gitlab.com/group/subgroup/repo'), {
      ok: true, repository: 'gitlab.com/group/subgroup/repo',
    })
  })
})

describe('isTrusted across hosts', () => {
  it('trusts a GitLab repository independently of GitHub', () => {
    assert.equal(isTrusted('gitlab.com/owner/repo', ['gitlab.com/owner/repo']), true)
    assert.equal(isTrusted('gitlab.com/owner/other', ['gitlab.com/owner/repo']), false)
  })

  it('does not treat the same path on another host as the same repository', () => {
    assert.equal(isTrusted('gitlab.com/owner/repo', ['github.com/owner/repo']), false)
  })
})

describe('isTrusted', () => {
  it('matches exactly', () => {
    assert.equal(isTrusted('github.com/owner/repo', ['github.com/owner/repo']), true)
  })

  it('is case-insensitive', () => {
    assert.equal(isTrusted('GitHub.com/Owner/Repo', ['github.com/owner/repo']), true)
  })

  it('does not trust another repository of the same owner', () => {
    assert.equal(isTrusted('github.com/owner/other', ['github.com/owner/repo']), false)
  })

  it('does not trust an empty value', () => {
    assert.equal(isTrusted('', ['github.com/owner/repo']), false)
  })
})

describe('addTrusted', () => {
  it('adds an entry once', () => {
    assert.deepEqual(addTrusted([], 'github.com/o/r'), ['github.com/o/r'])
    assert.deepEqual(addTrusted(['github.com/o/r'], 'GitHub.com/O/R'), ['github.com/o/r'])
  })
})

describe('removeTrusted', () => {
  it('removes the entry', () => {
    assert.deepEqual(removeTrusted(['github.com/o/r', 'github.com/o/s'], 'github.com/o/r'), ['github.com/o/s'])
  })
})

describe('normaliseTrusted', () => {
  it('keeps only usable identities', () => {
    const value = ['github.com/o/r', 'owner/repo', 'nope', 'a/*', 42]
    assert.deepEqual(normaliseTrusted(value), ['github.com/o/r', 'github.com/owner/repo'])
  })

  it('handles a non-array', () => {
    assert.deepEqual(normaliseTrusted(null), [])
  })
})
