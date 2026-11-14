import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { readInstalledCommits } from '../src/profile.js'

/**
 * A lockfile is read from whatever host the repository lives on, because this
 * plugin is not for one person's setup: GitHub, GitLab, Bitbucket, and a
 * self-hosted server must all yield the installed commit.
 */

const SHA = 'a39fef73ff6b885c2f39ccef86dcd75559405048'
const SHA2 = '2742c9d8cd5c434c8f6e84a47ae16a833e005167'

/** @type {string} */
let dir

before(async () => { dir = await mkdtemp(join(tmpdir(), 'updater-lock-')) })
after(async () => { await rm(dir, { recursive: true, force: true }) })

/**
 * Write a lockfile and read it back.
 * @param {string} text Lockfile body.
 * @returns {Promise<Map<string, string>>} Parsed commits.
 */
async function parse(text) {
  await writeFile(join(dir, 'pnpm-lock.yaml'), text)
  return readInstalledCommits(dir)
}

describe('installed commits', () => {
  it('reads a GitHub archive URL', async () => {
    const commits = await parse(`lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      dsh-kanban:
        specifier: github:owner/repo
        version: https://codeload.github.com/owner/repo/tar.gz/${SHA}

packages:

  dsh-kanban@https://codeload.github.com/owner/repo/tar.gz/${SHA}:
    resolution: {gitHosted: true, integrity: sha512-x, tarball: https://codeload.github.com/owner/repo/tar.gz/${SHA}}
`)
    assert.equal(commits.get('dsh-kanban'), SHA)
  })

  it('reads a GitLab archive URL', async () => {
    const commits = await parse(`packages:

  some-plugin@https://gitlab.com/owner/repo/-/archive/${SHA}/repo-${SHA}.tar.gz:
    resolution: {gitHosted: true, tarball: https://gitlab.com/owner/repo/-/archive/${SHA}/repo-${SHA}.tar.gz}
`)
    assert.equal(commits.get('some-plugin'), SHA)
  })

  it('reads a Bitbucket archive URL', async () => {
    const commits = await parse(`packages:

  other-plugin@https://bitbucket.org/owner/repo/get/${SHA}.tar.gz:
    resolution: {gitHosted: true, tarball: https://bitbucket.org/owner/repo/get/${SHA}.tar.gz}
`)
    assert.equal(commits.get('other-plugin'), SHA)
  })

  it('reads a self-hosted server', async () => {
    const commits = await parse(`packages:

  private-plugin@https://git.example.com/team/repo/archive/${SHA}.tar.gz:
    resolution: {gitHosted: true, tarball: https://git.example.com/team/repo/archive/${SHA}.tar.gz}
`)
    assert.equal(commits.get('private-plugin'), SHA)
  })

  it('reads several packages', async () => {
    const commits = await parse(`packages:

  a@https://codeload.github.com/o/r/tar.gz/${SHA}:
    resolution: {gitHosted: true, tarball: https://codeload.github.com/o/r/tar.gz/${SHA}}

  b@https://example.com/o/r/tar.gz/${SHA2}:
    resolution: {gitHosted: true, tarball: https://example.com/o/r/tar.gz/${SHA2}}
`)
    assert.equal(commits.size, 2)
    assert.equal(commits.get('a'), SHA)
    assert.equal(commits.get('b'), SHA2)
  })

  it('ignores a registry package, which has no commit', async () => {
    const commits = await parse(`packages:

  lodash@4.17.21:
    resolution: {integrity: sha512-y}
`)
    assert.equal(commits.size, 0)
  })

  it('returns nothing without a lockfile', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'updater-nolock-'))
    try {
      assert.equal((await readInstalledCommits(empty)).size, 0)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('keys a scoped package by its real name', async () => {
    // pnpm quotes a key that begins with `@`. Reading it without allowing the
    // quotes leaves one in the key, and a scoped plugin is then never matched
    // against its installed commit — reported as updating forever.
    const commits = await parse(`packages:

  '@acme/plugin'@https://codeload.github.com/acme/plugin/tar.gz/${SHA}:
    resolution: {gitHosted: true, tarball: https://codeload.github.com/acme/plugin/tar.gz/${SHA}}
`)
    assert.deepEqual([...commits.keys()], ['@acme/plugin'])
    assert.equal(commits.get('@acme/plugin'), SHA)
  })

  it('keys a scoped package on a self-hosted server', async () => {
    const commits = await parse(`packages:

  '@team/plugin'@https://git.example.com/team/plugin/archive/${SHA2}.tar.gz:
    resolution: {gitHosted: true, tarball: https://git.example.com/team/plugin/archive/${SHA2}.tar.gz}
`)
    assert.equal(commits.get('@team/plugin'), SHA2)
  })

  it('reads quoted and unquoted keys together', async () => {
    const commits = await parse(`packages:

  plain@https://codeload.github.com/o/r/tar.gz/${SHA}:
    resolution: {gitHosted: true, tarball: https://codeload.github.com/o/r/tar.gz/${SHA}}

  '@scope/pkg'@https://codeload.github.com/o/s/tar.gz/${SHA2}:
    resolution: {gitHosted: true, tarball: https://codeload.github.com/o/s/tar.gz/${SHA2}}
`)
    assert.equal(commits.get('plain'), SHA)
    assert.equal(commits.get('@scope/pkg'), SHA2)
  })
})
