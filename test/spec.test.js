import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cloneUrl, isPinned, movingSpec, parseDependency, pinnedSpec, repositoryIdentity, stripCredentials,
} from '../src/spec.js'

describe('parseDependency', () => {
  it('reads a registry range', () => {
    assert.deepEqual(parseDependency('dsh-subscriptions', '0.3.6'), {
      name: 'dsh-subscriptions', kind: 'registry', range: '0.3.6',
    })
  })

  it('reads a caret range', () => {
    assert.equal(parseDependency('dsh-codex', '^0.3.2').kind, 'registry')
  })

  it('reads a github shorthand without a ref', () => {
    assert.deepEqual(parseDependency('dsh-kanban', 'github:filipeesch/deepseek-harness-kanban'), {
      name: 'dsh-kanban', kind: 'git', repository: 'github.com/filipeesch/deepseek-harness-kanban',
    })
  })

  it('reads a gitlab subgroup shorthand as one repository', () => {
    assert.deepEqual(parseDependency('plugin', 'gitlab:group/subgroup/repo'), {
      name: 'plugin', kind: 'git', repository: 'gitlab.com/group/subgroup/repo',
    })
  })

  it('reads a gitlab subgroup shorthand with a pinned commit', () => {
    const parsed = parseDependency('plugin', 'gitlab:group/subgroup/repo#abc1234')
    assert.equal(parsed.repository, 'gitlab.com/group/subgroup/repo')
    assert.equal(parsed.ref, 'abc1234')
  })

  it('reads a github shorthand with a pinned commit', () => {
    assert.equal(parseDependency('dsh-kanban', 'github:filipeesch/deepseek-harness-kanban#a39fef7').ref, 'a39fef7')
  })

  it('reads a hosted repository url', () => {
    assert.deepEqual(parseDependency('x', 'https://github.com/owner/repo.git'), {
      name: 'x', kind: 'git', repository: 'github.com/owner/repo',
    })
  })

  it('reads an scp-like address', () => {
    assert.equal(parseDependency('x', 'git@github.com:owner/repo.git').repository, 'github.com/owner/repo')
  })

  it('reads a file path as local', () => {
    assert.deepEqual(parseDependency('x', 'file:../my-plugin'), { name: 'x', kind: 'local', path: '../my-plugin' })
  })

  it('reads an absolute path as local', () => {
    assert.equal(parseDependency('x', '/Users/me/plugin').kind, 'local')
  })

  it('keeps the package name separate from the repository name', () => {
    const parsed = parseDependency('dsh-kanban', 'github:filipeesch/deepseek-harness-kanban')
    assert.equal(parsed.name, 'dsh-kanban')
    assert.equal(parsed.repository, 'github.com/filipeesch/deepseek-harness-kanban')
  })

  it('reports an unusable value rather than guessing', () => {
    assert.equal(parseDependency('x', '').kind, 'unknown')
    assert.equal(parseDependency('x', 'ftp://host/a/b').kind, 'unknown')
  })
})

describe('pinnedSpec and movingSpec', () => {
  it('pins a github repository', () => {
    assert.equal(pinnedSpec('github.com/owner/repo', 'abc1234'), 'github:owner/repo#abc1234')
  })

  it('leaves another host as a full git url', () => {
    assert.equal(pinnedSpec('git.example.com/owner/repo', 'abc1234'), 'git+https://git.example.com/owner/repo.git#abc1234')
  })

  it('moves with the default branch', () => {
    assert.equal(movingSpec('github.com/owner/repo'), 'github:owner/repo')
    assert.equal(movingSpec('git.example.com/owner/repo'), 'git+https://git.example.com/owner/repo.git')
  })
})

describe('isPinned', () => {
  it('detects a pinned git spec', () => {
    assert.equal(isPinned('github:owner/repo#abc1234', 'x'), true)
  })

  it('reports an unfixed git spec', () => {
    assert.equal(isPinned('github:owner/repo', 'x'), false)
  })

  it('reports a registry range as unpinned', () => {
    assert.equal(isPinned('^0.3.2', 'dsh-codex'), false)
  })
})

describe('cloneUrl', () => {
  it('builds an https url', () => {
    assert.equal(cloneUrl('github.com/owner/repo'), 'https://github.com/owner/repo')
  })
})

describe('stripCredentials', () => {
  it('removes user information from an http url', () => {
    assert.equal(stripCredentials('https://token@github.com/o/r'), 'https://github.com/o/r')
    assert.equal(stripCredentials('git+https://user:secret@github.com/o/r'), 'git+https://github.com/o/r')
  })

  it('leaves a clean url alone', () => {
    assert.equal(stripCredentials('https://github.com/o/r'), 'https://github.com/o/r')
  })
})

describe('repositoryIdentity', () => {
  it('normalises case, www, and the git suffix', () => {
    assert.equal(repositoryIdentity('WWW.GitHub.com', '/Owner/Repo.git/'), 'github.com/owner/repo')
  })
})
