/** Syntax-check every JavaScript file in the package. */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Collect every `.js` file under the given directories, skipping the ones that
 * are not part of the shipped package.
 * @param {string} dir Directory to walk.
 * @returns {Promise<string[]>} Absolute paths, sorted for stable output.
 */
async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await collect(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(path)
  }
  return found
}

const targets = []
for (const name of ['index.js', 'client.js']) {
  try {
    if ((await stat(join(root, name))).isFile()) targets.push(join(root, name))
  } catch {
    // Not written yet: nothing to check.
  }
}
for (const dir of ['src', 'scripts', 'test']) {
  try {
    if ((await stat(join(root, dir))).isDirectory()) targets.push(...await collect(join(root, dir)))
  } catch {
    // A directory that does not exist yet has nothing to check.
  }
}

let failed = 0
for (const target of targets) {
  try {
    await run(process.execPath, ['--check', target])
  } catch (error) {
    failed += 1
    process.stderr.write(`syntax error: ${relative(root, target)}\n${error.stderr ?? error.message}\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`${failed} file(s) failed the syntax check\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`checked ${targets.length} file(s)\n`)
}
