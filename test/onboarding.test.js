import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/**
 * A service with no profile access, only the proposal logic under test.
 * @param {object} config Row configuration.
 * @returns {object} The service.
 */
function serviceWith(config) {
  return new UpdaterService({
    profileDir: '/nonexistent',
    pluginManager: {},
    config: () => config,
    writeConfig: async () => {},
    emit: () => {},
  })
}

/** A check result naming two git candidates and one registry candidate. */
const state = {
  candidates: [
    { name: 'dsh-kanban', parsed: { kind: 'git', repository: 'github.com/filipeesch/deepseek-harness-kanban' } },
    { name: 'dsh-codex', parsed: { kind: 'registry', range: '^0.3.2' } },
    { name: 'cursor-to-dsh', parsed: { kind: 'git', repository: 'github.com/filipeesch/cursor-to-dsh' } },
  ],
}

describe('first-use trust proposal', () => {
  it('proposes the repositories of installed git plugins', () => {
    const service = serviceWith({})
    assert.deepEqual(service.proposeRepositories(state), [
      'github.com/filipeesch/deepseek-harness-kanban',
      'github.com/filipeesch/cursor-to-dsh',
    ])
  })

  it('never proposes a registry candidate', () => {
    const service = serviceWith({})
    const proposed = service.proposeRepositories(state)
    assert.ok(!proposed.some((entry) => entry.includes('codex')))
  })

  it('proposes nothing once the user has decided', () => {
    // An explicit empty list is a decision: declining must not re-prompt.
    const service = serviceWith({ trustedRepositories: [] })
    assert.deepEqual(service.proposeRepositories(state), [])
  })

  it('proposes nothing once a repository is trusted', () => {
    const service = serviceWith({ trustedRepositories: ['github.com/filipeesch/deepseek-harness-kanban'] })
    assert.deepEqual(service.proposeRepositories(state), [])
  })

  it('proposes nothing when no candidate is installed from git', () => {
    const service = serviceWith({})
    assert.deepEqual(service.proposeRepositories({ candidates: [{ name: 'x', parsed: { kind: 'registry' } }] }), [])
  })

  it('deduplicates a repository named twice', () => {
    const service = serviceWith({})
    const duplicated = {
      candidates: [
        { name: 'a', parsed: { kind: 'git', repository: 'github.com/o/r' } },
        { name: 'b', parsed: { kind: 'git', repository: 'github.com/o/r' } },
      ],
    }
    assert.deepEqual(service.proposeRepositories(duplicated), ['github.com/o/r'])
  })
})
