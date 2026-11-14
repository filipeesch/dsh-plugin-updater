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

/**
 * Write one installed registry bundle into the profile.
 * @param {string} name Package name.
 * @returns {Promise<void>}
 */
async function writeBundle(name) {
  const dir = join(profileDir, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', dsh: { bundle: {} } }, undefined, 2) + '\n')
}

before(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'updater-recheck-'))
  cacheDir = await mkdtemp(join(tmpdir(), 'updater-recheck-cache-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'p',
    dependencies: { a: '^1.0.0', b: '^1.0.0', c: '^1.0.0' },
  }, undefined, 2) + '\n')
  await writeBundle('a')
  await writeBundle('b')
  await writeBundle('c')
})
after(async () => {
  await rm(profileDir, { recursive: true, force: true })
  await rm(cacheDir, { recursive: true, force: true })
})

/**
 * A service whose registry answers are controlled per candidate.
 * @param {(name: string) => Promise<object>} listVersions Version listing.
 * @returns {object} The service.
 */
function service(listVersions) {
  return new UpdaterService({
    profileDir, cacheDir,
    pluginManager: { listVersions },
    config: () => ({}),
    writeConfig: async () => {},
    emit: () => {},
  })
}

/** A listed answer offering 2.0.0. */
const newer = { status: 'listed', installed: '1.0.0', versions: [{ version: '2.0.0' }] }
/** A listed answer with nothing newer. */
const current = { status: 'listed', installed: '1.0.0', versions: [] }

describe('recheck', () => {
  it('checks only the named candidate and keeps the others', async () => {
    let failB = true
    const target = service(async (name) => {
      if (name === 'b' && failB) throw new Error('registry down')
      if (name === 'c') return current
      return newer
    })
    await target.check()
    assert.ok(target.lastCheck.updates.some((entry) => entry.name === 'a'))
    assert.ok(target.lastCheck.unchecked.some((entry) => entry.name === 'b'))
    failB = false
    const snapshot = await target.recheck({ name: 'b' })
    assert.ok(snapshot.updates.some((entry) => entry.name === 'b'))
    assert.ok(snapshot.updates.some((entry) => entry.name === 'a'))
    assert.equal(snapshot.unchecked.some((entry) => entry.name === 'b'), false)
    assert.equal(snapshot.updates.some((entry) => entry.name === 'c'), false)
  })

  it('keeps a candidate unchecked when the re-check fails again', async () => {
    const target = service(async (name) => {
      if (name === 'b') throw new Error('registry still down')
      if (name === 'c') return current
      return newer
    })
    await target.check()
    const snapshot = await target.recheck({ name: 'b' })
    const entry = snapshot.unchecked.find((candidate) => candidate.name === 'b')
    assert.ok(entry)
    assert.match(entry.reason, /registry still down/)
  })

  it('waits for a running detection instead of starting a second one', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let gateA = true
    const target = service(async (name) => {
      if (name === 'a' && gateA) { gateA = false; await gate }
      if (name === 'c') return current
      return newer
    })
    const detection = target.refresh()
    const rechecked = target.recheck({ name: 'b' })
    release()
    await detection
    const snapshot = await rechecked
    assert.ok(snapshot.updates.some((entry) => entry.name === 'b'))
  })
})
