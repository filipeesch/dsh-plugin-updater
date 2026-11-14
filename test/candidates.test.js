import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyCandidate, selectCandidates } from '../src/candidates.js'

/** Bundle declaration by name. */
const bundles = (names) => (name) => names.includes(name)

describe('selectCandidates', () => {
  it('keeps a direct dependency that declares dsh.bundle', () => {
    const chosen = selectCandidates({
      dependencies: { 'dsh-kanban': 'github:o/r' },
      declaresBundle: bundles(['dsh-kanban']),
    })
    assert.deepEqual(chosen, ['dsh-kanban'])
  })

  it('drops a direct dependency that declares no bundle', () => {
    const chosen = selectCandidates({
      dependencies: { 'plain-pkg': '^1.0.0', 'dsh-kanban': 'github:o/r' },
      declaresBundle: bundles(['dsh-kanban']),
    })
    assert.deepEqual(chosen, ['dsh-kanban'])
  })

  it('drops a bundle the installation itself supplies', () => {
    // The Host reports such a package as `availability: 'installation'`; it ships
    // with the application, so it is not the profile's to update.
    const chosen = selectCandidates({
      dependencies: { 'dsh-base': '^1.0.0', 'dsh-kanban': 'github:o/r' },
      declaresBundle: bundles(['dsh-base', 'dsh-kanban']),
      installationProvides: (name) => name === 'dsh-base',
    })
    assert.deepEqual(chosen, ['dsh-kanban'])
  })

  it('keeps a bundle the installation does not supply', () => {
    const chosen = selectCandidates({
      dependencies: { 'dsh-kanban': 'github:o/r' },
      declaresBundle: bundles(['dsh-kanban']),
      installationProvides: () => false,
    })
    assert.deepEqual(chosen, ['dsh-kanban'])
  })

  it('preserves profile order', () => {
    const chosen = selectCandidates({
      dependencies: { a: 'x', b: 'y', c: 'z' },
      declaresBundle: () => true,
    })
    assert.deepEqual(chosen, ['a', 'b', 'c'])
  })

  it('handles an empty profile', () => {
    assert.deepEqual(selectCandidates({ declaresBundle: () => true }), [])
  })
})

describe('classifyCandidate', () => {
  const base = { dependencies: { pack: 'x' }, declaresBundle: () => true }

  it('accepts a bundle dependency', () => {
    assert.equal(classifyCandidate({ ...base, name: 'pack' }), 'candidate')
  })

  it('rejects a name that is not a direct dependency', () => {
    assert.equal(classifyCandidate({ ...base, name: 'transitive' }), 'not-a-dependency')
  })

  it('rejects a dependency without a bundle', () => {
    assert.equal(classifyCandidate({ ...base, name: 'pack', declaresBundle: () => false }), 'no-bundle')
  })

  it('accepts a direct dependency that declares a bundle', () => {
    assert.equal(classifyCandidate({ ...base, name: 'pack' }), 'candidate')
  })

  it('rejects a name the installation provides', () => {
    assert.equal(classifyCandidate({ ...base, name: 'pack', installationProvides: () => true }), 'installation-provided')
  })
})

describe('readBundles uses the same selection rule', () => {
  // The shipped path and the tested rule were implemented twice, and only the
  // unused copy was tested. A manifest is read once per dependency and the
  // shared rule decides, so a divergence is impossible.
  it('reads only direct dependencies that declare a bundle', async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readBundles } = await import('../src/profile.js')

    const dir = await mkdtemp(join(tmpdir(), 'updater-bundles-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: 'p',
        dependencies: { 'with-bundle': 'github:o/with-bundle', 'no-bundle': '1.0.0' },
      }))
      for (const [name, declares] of [['with-bundle', true], ['no-bundle', false]]) {
        await mkdir(join(dir, 'node_modules', name), { recursive: true })
        await writeFile(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
          name,
          version: '1.0.0',
          ...declares ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {},
        }))
      }
      const bundles = await readBundles(dir, (name, value) => ({ name, kind: 'git', repository: 'github.com/o/r', saved: value }))
      assert.deepEqual(bundles.map((entry) => entry.name), ['with-bundle'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('drops a direct dependency whose installed manifest is missing', async () => {
    // A dependency listed in the profile but absent from node_modules is not a
    // candidate: offering to update what is not installed would be wrong.
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readBundles } = await import('../src/profile.js')

    const dir = await mkdtemp(join(tmpdir(), 'updater-missing-'))
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: 'p', dependencies: { absent: 'github:o/absent' },
      }))
      const bundles = await readBundles(dir, (name) => ({ name, kind: 'git', repository: 'github.com/o/r' }))
      assert.deepEqual(bundles, [])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the installation inventory is wired, not decorative', () => {
  it('reads a package the host reports as installation-supplied as not a candidate', async () => {
    // The spec scenario "Installation-provided bundle is not a candidate" needs
    // the host's own answer, which is `availability: 'installation'`.
    const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readBundles } = await import('../src/profile.js')

    const dir = await mkdtemp(join(tmpdir(), 'updater-shipped-'))
    try {
      const names = ['shipped-bundle', 'profile-bundle']
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: 'p',
        dependencies: Object.fromEntries(names.map((name) => [name, `github:o/${name}`])),
      }))
      for (const name of names) {
        await mkdir(join(dir, 'node_modules', name), { recursive: true })
        await writeFile(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
          name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
        }))
      }
      const parse = (name) => ({ name, kind: 'git', repository: `github.com/o/${name}` })
      const bundles = await readBundles(dir, parse, { installationProvides: (name) => name === 'shipped-bundle' })
      assert.deepEqual(bundles.map((entry) => entry.name), ['profile-bundle'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
