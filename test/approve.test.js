import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideBuildApproval, describeApproval } from '../src/approve.js'

const REPO = 'github.com/filipeesch/deepseek-harness-kanban'
const KEY = 'dsh-kanban@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/a39fef73ff6b885c2f39ccef86dcd75559405048'
const OTHER = 'transitive@https://codeload.github.com/someone/else/tar.gz/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('decideBuildApproval', () => {
  it('does nothing when no script was blocked', () => {
    const decision = decideBuildApproval({ pendingBuilds: [], repository: REPO, trustedRepositories: [REPO] })
    assert.equal(decision.decision, 'none')
    assert.deepEqual(decision.keys, [])
  })

  it('approves the exact key for a trusted repository', () => {
    const decision = decideBuildApproval({ pendingBuilds: [KEY], repository: REPO, trustedRepositories: [REPO] })
    assert.equal(decision.decision, 'approve')
    assert.deepEqual(decision.keys, [KEY])
  })

  it('asks for an untrusted repository', () => {
    const decision = decideBuildApproval({ pendingBuilds: [KEY], repository: REPO, trustedRepositories: [] })
    assert.equal(decision.decision, 'ask')
    assert.deepEqual(decision.keys, [KEY])
  })

  it('does not trust another repository of the same owner', () => {
    const decision = decideBuildApproval({
      pendingBuilds: [KEY], repository: REPO, trustedRepositories: ['github.com/filipeesch/other-repo'],
    })
    assert.equal(decision.decision, 'ask')
  })

  it('defers the trusted keys when another script is untrusted', () => {
    const decision = decideBuildApproval({ pendingBuilds: [KEY, OTHER], repository: REPO, trustedRepositories: [REPO] })
    assert.equal(decision.decision, 'ask')
    assert.deepEqual(decision.keys, [OTHER])
    assert.deepEqual(decision.deferred, [KEY])
  })

  it('falls back to parsing the run output', () => {
    const decision = decideBuildApproval({
      output: 'Ignored build scripts: esbuild', repository: REPO, trustedRepositories: ['github.com/evanw/esbuild'],
    })
    // A registry key belongs to no repository, so it cannot be approved by trust.
    assert.equal(decision.decision, 'ask')
  })

  it('ignores a wildcard from the run output', () => {
    const decision = decideBuildApproval({ output: 'Ignored build scripts: @scope/*', repository: REPO, trustedRepositories: [REPO] })
    assert.equal(decision.decision, 'none')
  })

  it('deduplicates reported keys', () => {
    const decision = decideBuildApproval({ pendingBuilds: [KEY, KEY], repository: REPO, trustedRepositories: [REPO] })
    assert.equal(decision.keys.length, 1)
  })
})

describe('describeApproval', () => {
  it('names the repository, keys, and packages', () => {
    const described = describeApproval(REPO, [KEY])
    assert.equal(described.repository, REPO)
    assert.deepEqual(described.packages, ['dsh-kanban'])
    assert.deepEqual(described.keys, [KEY])
  })
})

describe('decideBuildApproval refuses a sibling repository end to end', () => {
  const SHA = 'a'.repeat(40)

  /**
   * A key for a package built from a given repository path.
   * @param {string} name Package name.
   * @param {string} path Repository path.
   * @returns {string} The approval key pnpm would report.
   */
  const keyFor = (name, path) => `${name}@https://codeload.github.com/${path}/tar.gz/${SHA}`

  it('does not auto-approve a sibling of the trusted repository', () => {
    // The user trusted o/safe. Code from o/safe-but-malicious must prompt, even
    // though the shorter name is contained in the longer one.
    const decision = decideBuildApproval({
      pendingBuilds: [keyFor('sibling', 'o/safe-but-malicious')],
      repository: 'github.com/o/safe-but-malicious',
      trustedRepositories: ['github.com/o/safe'],
    })
    assert.equal(decision.decision, 'ask')
    assert.deepEqual(decision.keys, [keyFor('sibling', 'o/safe-but-malicious')])
  })

  it('auto-approves only the trusted repository itself', () => {
    const decision = decideBuildApproval({
      pendingBuilds: [keyFor('own', 'o/safe')],
      repository: 'github.com/o/safe',
      trustedRepositories: ['github.com/o/safe'],
    })
    assert.equal(decision.decision, 'approve')
  })

  it('asks when a trusted key and a sibling key are reported together', () => {
    const decision = decideBuildApproval({
      pendingBuilds: [keyFor('own', 'o/safe'), keyFor('sibling', 'o/safe-malware')],
      repository: 'github.com/o/safe-malware',
      trustedRepositories: ['github.com/o/safe'],
    })
    assert.equal(decision.decision, 'ask')
    assert.deepEqual(decision.keys, [keyFor('sibling', 'o/safe-malware')])
    assert.deepEqual(decision.deferred, [keyFor('own', 'o/safe')])
  })
})
