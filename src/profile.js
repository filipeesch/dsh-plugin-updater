/**
 * Reading the profile: what is installed, from where, and at which commit.
 *
 * All reads are of files the host already owns. Nothing here writes.
 * @module dsh-plugin-updater/profile
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Read and parse a JSON file.
 * @param {string} path Absolute path.
 * @returns {Promise<unknown>} Parsed content.
 * @throws {Error} When the file is missing or is not JSON.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * The dependency map of a profile manifest.
 * @param {string} profileDir Profile directory.
 * @returns {Promise<Record<string, string>>} Dependency name to saved value.
 */
export async function readDependencies(profileDir) {
  const manifest = /** @type {{dependencies?: Record<string, string>}} */ (await readJson(join(profileDir, 'package.json')))
  return manifest.dependencies ?? {}
}

/**
 * The bundle selection of a profile manifest.
 * @param {string} profileDir Profile directory.
 * @returns {Promise<string[]>} Selected bundle names.
 */
export async function readSelection(profileDir) {
  const manifest = /** @type {{dsh?: {profile?: {bundles?: string[]}}}} */ (await readJson(join(profileDir, 'package.json')))
  return manifest.dsh?.profile?.bundles ?? []
}

import { selectCandidates } from './candidates.js'

/**
 * The commits the lockfile resolved for git-hosted packages.
 *
 * A git dependency resolves to an archive whose URL ends in the commit, and the
 * saved spec carries no ref, so the lockfile is the only place the installed
 * commit appears. The host in that URL varies by where the repository lives —
 * `codeload.github.com` for GitHub, a GitLab or Bitbucket archive URL, or a
 * self-hosted server — so the commit is read from any `tarball:` entry rather
 * than from one host's URL shape.
 * @param {string} profileDir Profile directory.
 * @returns {Promise<Map<string, string>>} Package name to installed commit.
 */
export async function readInstalledCommits(profileDir) {
  let text
  try {
    text = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    return new Map()
  }
  const commits = new Map()
  // Read one package block at a time. A single regular expression spanning
  // lines would let an entry whose resolution carries no `tarball` — an older
  // pnpm writes `{commit, repo, type: git}` — borrow the next entry's commit,
  // and a wrong commit is worse than none: it defeats the "is this current"
  // comparison and points a restoration at a stranger's revision.
  let name
  let tarball
  const flush = () => {
    if (name !== undefined && tarball !== undefined) {
      const commit = commitOf(tarball)
      if (commit !== undefined) commits.set(name, commit)
    }
    name = undefined
    tarball = undefined
  }
  for (const line of text.split('\n')) {
    // A package key starts at two spaces; anything deeper belongs to its block.
    const key = /^ {2}(.+):$/.exec(line)
    if (key !== null) {
      flush()
      name = packageNameOf(key[1])
      continue
    }
    if (name !== undefined && tarball === undefined) {
      const found = /^\s+resolution: \{[^}]*tarball: (\S+?)\}/.exec(line)
      if (found !== null) tarball = found[1]
    }
  }
  flush()
  return commits
}

/**
 * The package name a lockfile key names.
 *
 * A git key is `<name>@<url>`, and pnpm quotes a name that begins with `@`, so
 * the key may read `'@acme/plugin'@https://…`. The version form (`lodash@4.17.21`)
 * is also accepted and simply yields a name with no commit behind it.
 * @param {string} key Key as written, without its trailing colon.
 * @returns {string} The package name.
 */
function packageNameOf(key) {
  const unquoted = key.startsWith("'") && key.endsWith("'")
    ? key.slice(1, -1)
    : key.startsWith("'")
      ? key.slice(1)
      : key
  // A scoped name carries its own leading `@`, so the separator is the next one.
  const from = unquoted.startsWith('@') ? unquoted.indexOf('@', unquoted.indexOf('/') + 1) : unquoted.indexOf('@')
  const name = from === -1 ? unquoted : unquoted.slice(0, from)
  return name.replace(/'$/, '')
}

/**
 * The commit an archive URL resolves to.
 * @param {string} url Archive URL from the lockfile.
 * @returns {string|undefined} A 40-character commit, when the URL names one.
 */
function commitOf(url) {
  const sha = /([a-f0-9]{40})(?:\b|$)/i.exec(url.replace(/[),}\]]+$/, ''))
  return sha === null ? undefined : sha[1].toLowerCase()
}

/**
 * Whether the package manager's workspace settings mention a package, which
 * tells whether it ever needed a build decision.
 * @param {string} profileDir Profile directory.
 * @param {string} packageName Package name.
 * @returns {Promise<boolean>} True when an approval key names it.
 */
export async function mentionsBuildApproval(profileDir, packageName) {
  try {
    const text = await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
    return new RegExp(`^ {2}${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@`, 'm').test(text)
  } catch {
    return false
  }
}

/**
 * Read a package manifest from the profile's installed files.
 * @param {string} profileDir Profile directory.
 * @param {string} packageName Package name.
 * @returns {Promise<{name?: string, version?: string, declaresBundle: boolean}>}
 *   The facts this plugin needs; a missing package reports no bundle.
 */
export async function readInstalledManifest(profileDir, packageName) {
  try {
    const manifest = /** @type {{name?: string, version?: string, dsh?: {bundle?: unknown}}} */ (
      await readJson(join(profileDir, 'node_modules', packageName, 'package.json'))
    )
    return {
      ...manifest.name === undefined ? {} : { name: manifest.name },
      ...manifest.version === undefined ? {} : { version: manifest.version },
      declaresBundle: manifest.dsh?.bundle !== undefined,
    }
  } catch {
    return { declaresBundle: false }
  }
}

/**
 * Every installed package that declares a bundle, with its source facts.
 * @param {string} profileDir Profile directory.
 * @param {(name: string, value: string) => import('./spec.js').ParsedDependency} parse
 * @param {{installationProvides?: (name: string) => boolean}} [facts]
 *   Facts the host owns. `installationProvides` answers whether the Harness
 *   itself supplies a bundle, which the Host reports as
 *   `BundleInfo.availability === 'installation'`.
 * @returns {Promise<{name: string, version?: string, saved: string, parsed: object}[]>}
 *   One entry per bundle dependency, in profile order.
 */
export async function readBundles(profileDir, parse, facts = {}) {
  const dependencies = await readDependencies(profileDir)
  // One manifest read per dependency, then the same selection rule the candidate
  // tests exercise: this way the rule that is tested is the rule that ships.
  const manifests = new Map()
  for (const name of Object.keys(dependencies)) {
    manifests.set(name, await readInstalledManifest(profileDir, name))
  }
  const chosen = new Set(selectCandidates({
    dependencies,
    declaresBundle: (name) => manifests.get(name)?.declaresBundle === true,
    ...facts.installationProvides === undefined ? {} : { installationProvides: facts.installationProvides },
  }))
  const bundles = []
  for (const [name, saved] of Object.entries(dependencies)) {
    if (!chosen.has(name)) continue
    const manifest = manifests.get(name) ?? { declaresBundle: false }
    bundles.push({
      name,
      ...manifest.version === undefined ? {} : { version: manifest.version },
      saved,
      parsed: parse(name, saved),
    })
  }
  return bundles
}

/**
 * The newest modification time of a local plugin's own files, and of the running
 * application's start time.
 * @param {string} directory Local plugin directory.
 * @param {string[]} relativePaths Files to compare, relative to the directory.
 * @returns {Promise<number|undefined>} Newest modification time in milliseconds.
 */
export async function newestModification(directory, relativePaths) {
  let newest
  for (const relative of relativePaths) {
    try {
      const { mtimeMs } = await import('node:fs/promises').then((fs) => fs.stat(join(directory, relative)))
      if (newest === undefined || mtimeMs > newest) newest = mtimeMs
    } catch {
      // A missing file says nothing about freshness.
    }
  }
  return newest
}
