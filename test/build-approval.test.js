import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  blockedBuildKeys, carriesCredential, isPattern, keyBelongsToTrusted, splitKey,
} from '../src/build-approval.js'

describe('blockedBuildKeys', () => {
  it('reads the ignored-scripts form', () => {
    assert.deepEqual(blockedBuildKeys('Ignored build scripts: esbuild, sharp'), ['esbuild', 'sharp'])
  })

  it('reads the git-prepare form with its commit-scoped key', () => {
    const key = 'dsh-kanban@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/a39fef73ff6b885c2f39ccef86dcd75559405048'
    const output = ['ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  Ignored build scripts: dsh-kanban.', '', 'To allow this, add:', 'allowBuilds:', `  ${key}: true`].join('\n')
    assert.deepEqual(blockedBuildKeys(output), [key])
  })

  it('refuses a wildcard', () => {
    assert.deepEqual(blockedBuildKeys('Ignored build scripts: @scope/*, esbuild'), ['esbuild'])
  })

  it('refuses a key carrying a credential', () => {
    const output = 'Ignored build scripts: a@https://user:secret@github.com/o/r, plain'
    assert.deepEqual(blockedBuildKeys(output), ['plain'])
  })

  it('deduplicates and trims', () => {
    assert.deepEqual(blockedBuildKeys('Ignored build scripts: a, a ,  b '), ['a', 'b'])
  })

  it('returns nothing for unrelated output', () => {
    assert.deepEqual(blockedBuildKeys('installed successfully'), [])
    assert.deepEqual(blockedBuildKeys(undefined), [])
  })
})

describe('isPattern', () => {
  it('detects wildcards', () => {
    assert.equal(isPattern('@scope/*'), true)
    assert.equal(isPattern('pkg?'), true)
    assert.equal(isPattern('exact-name'), false)
  })
})

describe('carriesCredential', () => {
  it('detects a user and password', () => {
    assert.equal(carriesCredential('pkg@https://user:secret@github.com/o/r'), true)
    assert.equal(carriesCredential('pkg@https://token@github.com/o/r'), true)
  })

  it('accepts a clean url', () => {
    assert.equal(carriesCredential('pkg@https://github.com/o/r'), false)
  })

  it('accepts a registry name', () => {
    assert.equal(carriesCredential('esbuild'), false)
  })
})

describe('splitKey', () => {
  it('splits a sourced key', () => {
    assert.deepEqual(splitKey('pkg@https://h/o/r'), { packageName: 'pkg', source: 'https://h/o/r' })
  })

  it('reports a bare name', () => {
    assert.deepEqual(splitKey('esbuild'), { packageName: 'esbuild' })
  })
})

describe('keyBelongsToTrusted', () => {
  it('matches a trusted repository', () => {
    const key = 'dsh-kanban@https://codeload.github.com/filipeesch/deepseek-harness-kanban/tar.gz/abc'
    assert.equal(keyBelongsToTrusted(key, ['github.com/filipeesch/deepseek-harness-kanban']), true)
  })

  it('does not match a repository of the same owner', () => {
    const key = 'other@https://codeload.github.com/filipeesch/other-repo/tar.gz/abc'
    assert.equal(keyBelongsToTrusted(key, ['github.com/filipeesch/deepseek-harness-kanban']), false)
  })

  it('does not match a registry key', () => {
    assert.equal(keyBelongsToTrusted('esbuild', ['github.com/o/r']), false)
  })
})

describe('keyBelongsToTrusted refuses a sibling repository', () => {
  // A substring test approves these, and every one of them runs a third party's
  // build script without asking. Each case is named for the mistake it catches.
  const TRUSTED = ['github.com/o/safe']
  const SHA = 'a'.repeat(40)

  /**
   * @param {string} path Repository path in an archive URL.
   * @returns {string} An approval key for that path.
   */
  const keyFor = (path) => `pkg@https://codeload.github.com/${path}/tar.gz/${SHA}`

  it('refuses a sibling whose name starts with the trusted one', () => {
    assert.equal(keyBelongsToTrusted(keyFor('o/safe-but-malicious'), TRUSTED), false)
  })

  it('refuses a sibling that differs only by a suffix digit', () => {
    assert.equal(keyBelongsToTrusted(keyFor('o/safe2'), TRUSTED), false)
  })

  it('refuses a foreign host whose path contains the trusted identity', () => {
    assert.equal(keyBelongsToTrusted(`pkg@https://evil.com/github.com/o/safe/tar.gz/${SHA}`, TRUSTED), false)
  })

  it('refuses the owner alone, which is a broader scope than a repository', () => {
    assert.equal(keyBelongsToTrusted(keyFor('o'), TRUSTED), false)
  })

  it('accepts the trusted repository itself', () => {
    assert.equal(keyBelongsToTrusted(keyFor('o/safe'), TRUSTED), true)
  })

  it('accepts the trusted repository through its archive host', () => {
    // GitHub serves git dependencies from codeload, not from github.com.
    assert.equal(keyBelongsToTrusted(`pkg@https://codeload.github.com/o/safe/tar.gz/${SHA}`, TRUSTED), true)
  })

  it('distinguishes a repository from a nested project beneath its path', () => {
    // The archive suffix is stripped before comparing; a project nested under a
    // trusted path is still a different repository.
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/repo/-/archive/${SHA}/x.tar.gz`, ['gitlab.com/g/repo']), true)
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/repo/sub/-/archive/${SHA}/x.tar.gz`, ['gitlab.com/g/repo']), false)
  })

  it('refuses a GitLab sibling of a subgroup project', () => {
    const trusted = ['gitlab.com/g/sub/repo']
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/sub/repo/-/archive/${SHA}/x.tar.gz`, trusted), true)
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/sub/repo-malware/-/archive/${SHA}/x.tar.gz`, trusted), false)
  })

  it('accepts an scp-like source for the trusted repository', () => {
    assert.equal(keyBelongsToTrusted('pkg@git@github.com:o/safe.git', TRUSTED), true)
    assert.equal(keyBelongsToTrusted('pkg@git@github.com:o/safe.git.bak', TRUSTED), false)
  })

  it('refuses a local path, which names no repository', () => {
    assert.equal(keyBelongsToTrusted('pkg@file:../somewhere', TRUSTED), false)
  })
})

describe('splitKey with a scoped package', () => {
  it('splits after the name rather than at its leading @', () => {
    // A scoped name starts with `@`, so the first `@` is not the separator.
    assert.deepEqual(splitKey('@acme/plugin@https://h/o/r'), {
      packageName: '@acme/plugin', source: 'https://h/o/r',
    })
  })

  it('reports a bare scoped name with no source', () => {
    assert.deepEqual(splitKey('@acme/plugin'), { packageName: '@acme/plugin' })
  })
})

describe('carriesCredential with a scoped package', () => {
  // A scoped name begins with `@`, so a check that splits at the first one sees
  // the scope as the separator and never reaches the URL. The credential would
  // then be written into the profile's settings file.
  it('detects a credential in a scoped key', () => {
    assert.equal(carriesCredential('@acme/plugin@https://user:pass@github.com/o/r'), true)
  })

  it('detects a token in a scoped git+https key', () => {
    assert.equal(carriesCredential('@acme/plugin@git+https://ghp_token@github.com/o/r'), true)
  })

  it('still detects a credential in an unscoped key', () => {
    assert.equal(carriesCredential('pkg@https://user:pass@github.com/o/r'), true)
  })

  it('accepts a scoped key with no credential', () => {
    assert.equal(carriesCredential('@acme/plugin@https://github.com/o/r'), false)
  })

  it('never refuses a plain scp address', () => {
    // `pkg@git@host:owner/repo` names a user, not a password.
    assert.equal(carriesCredential('pkg@git@github.com:o/r'), false)
  })

  it('keeps a credentialed scoped key out of the reported keys', () => {
    const output = 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED\n\nallowBuilds:\n  @acme/plugin@https://ghp_token@github.com/o/r: true\n'
    assert.deepEqual(blockedBuildKeys(output), [])
  })
})

describe('a repository whose path contains an archive word is still recognised', () => {
  // Stripping the suffix finds the wrong boundary here, and the repository can
  // never match its own trust: a false refusal that keeps asking forever.
  const SHA = 'a'.repeat(40)

  it('recognises a subgroup literally named get', () => {
    const trusted = ['gitlab.com/g/get/repo']
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/get/repo/-/archive/${SHA}/x.tar.gz`, trusted), true)
  })

  it('recognises a subgroup literally named archive', () => {
    const trusted = ['gitlab.com/g/archive/repo']
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/archive/repo/-/archive/${SHA}/x.tar.gz`, trusted), true)
  })

  it('still refuses a sibling of a repository nested in subgroups', () => {
    const trusted = ['gitlab.com/g/sub/repo']
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/sub/repo-malware/-/archive/${SHA}/x.tar.gz`, trusted), false)
    assert.equal(keyBelongsToTrusted(`pkg@https://gitlab.com/g/parent/repo/-/archive/${SHA}/x.tar.gz`, trusted), false)
  })
})

describe('a scoped key with no scope boundary', () => {
  // `@scope` with no `/name` is not a package name. Guessing a boundary lands
  // inside the URL, where the next `/` belongs to `https://`, so the credential's
  // `@` is taken for the separator and the secret survives.
  const DEGENERATE = '@scope@https://user:s3cr3t@github.com/o/r'

  it('is treated as credential-bearing rather than clean', () => {
    assert.equal(carriesCredential(DEGENERATE), true)
  })

  it('is never reported for writing', () => {
    const output = `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED\n\nallowBuilds:\n  ${DEGENERATE}: true\n`
    assert.deepEqual(blockedBuildKeys(output), [])
  })

  it('reports no source, since none can be located', () => {
    assert.deepEqual(splitKey(DEGENERATE), { packageName: DEGENERATE })
  })

  it('does not affect a valid scoped key', () => {
    assert.equal(carriesCredential('@acme/plugin@https://github.com/o/r'), false)
    assert.deepEqual(splitKey('@acme/plugin@https://h/o/r'), {
      packageName: '@acme/plugin', source: 'https://h/o/r',
    })
  })

  it('does not affect a bare scoped name', () => {
    assert.deepEqual(splitKey('@acme/plugin'), { packageName: '@acme/plugin' })
    assert.equal(carriesCredential('@acme/plugin'), false)
  })
})
