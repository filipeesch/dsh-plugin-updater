import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { UpdaterService } from '../src/host.js'

/** @type {string} */
let profileDir
/** @type {string} */
let cacheDir

const COMMIT = 'a39fef73ff6b885c2f39ccef86dcd75559405048'

/**
 * Write one installed bundle manifest.
 * @param {string} name Package name.
 * @returns {Promise<void>}
 */
async function writeBundle(name) {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dsh: { bundle: {} } }, undefined, 2) + '\n')
}

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-recheck-commits-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'updater-recheck-commits-cache-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'p',
    dependencies: { reg: '^1.0.0', gitp: 'github:o/r' },
  }, undefined, 2) + '\n')
  await writeBundle('reg')
  await writeBundle('gitp')
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    '  gitp@https://codeload.github.com/o/r/tar.gz/' + COMMIT + ':',
    '    resolution: {tarball: https://codeload.github.com/o/r/tar.gz/' + COMMIT + '}',
    '',
  ].join('\n'))
})
after(async () => {
  await rm(profileDir, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

describe('recheck and installed commits', () => {
  it('keeps every installed commit when one candidate is re-checked', async () => {
    const target = new UpdaterService({
      profileDir,
      cacheDir,
      pluginManager: {
        async listVersions() {
          return { status: 'listed', installed: '1.0.0', versions: [{ version: '2.0.0', bundle: true }] }
        },
      },
      config: () => ({}),
      writeConfig: async () => {},
      emit: () => {},
    })
    target.lastCheck = { candidates: [], updates: [], reloads: [], unchecked: [], ignored: [], total: 0 }
    const snapshot = await target.recheck({ name: 'reg' })
    const git = snapshot.candidates.find((entry) => entry.name === 'gitp')
    assert.ok(git)
    assert.equal(git.installedCommit, COMMIT)
    assert.ok(snapshot.updates.some((entry) => entry.name === 'reg'))
  })
})
