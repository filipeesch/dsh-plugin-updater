/**
 * Loading the shipped browser bundle the way the real module table does.
 *
 * The real table resolves a specifier only when it is a platform seed, a
 * materialized module, or a registered factory keyed by the specifier with a
 * trailing `/client` stripped. A harness that hands the bundle whatever it asks
 * for proves nothing about loading, which is how an unresolvable `/remote`
 * import once survived a green suite.
 * @module test/helpers/bundle
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const nodeRequire = createRequire(import.meta.url)

/** Platform seeds the shell provides by name. */
const SEEDS = new Set(['react', 'zod'])

/**
 * The real strip rule.
 * @param {string} spec Specifier.
 * @returns {string} The factory key it addresses.
 */
function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

/**
 * Whether the platform seed the wire face needs is resolvable here.
 * @returns {boolean} True when `zod` can be loaded.
 */
export function hasZod() {
  try {
    nodeRequire('zod')
    return true
  } catch {
    return false
  }
}

/** A skip marker for tests that cannot run without the platform seed. */
export const ZOD_REQUIRED = { skip: hasZod() ? false : 'zod resolves from the host profile, not a bare checkout' }

/**
 * Load the bundle the way the client does.
 * @returns {{exports: Map<string, object>, requested: string[]}} Loaded factories and every specifier asked for.
 */
export function loadBundle() {
  const source = readFileSync(new URL('../../client.js', import.meta.url), 'utf8')
  const registered = new Map()
  const requested = []
  const window = {
    __ModuleLoader__: { load(options) { registered.set(options.id, options) } },
  }
  /** A React stand-in that records nothing and returns plain descriptors. */
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
  }
  const context = { window, console, URL, Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp, Set, Map, Promise, Symbol }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'client.js' })

  const exportsMap = new Map()
  /** Resolve one specifier exactly as the table does. */
  const makeRequire = (spec) => {
    requested.push(spec)
    if (spec === 'react') return React
    if (spec === 'zod') return { z: nodeRequire('zod') }
    const id = stripClientSuffix(spec)
    if (exportsMap.has(id)) return exportsMap.get(id)
    const registration = registered.get(id)
    if (registration !== undefined) {
      const produced = registration.factory(makeRequire)
      exportsMap.set(id, produced)
      return produced
    }
    throw new Error(`require("${spec}") missed the module table`)
  }

  for (const [id] of registered) {
    if (exportsMap.has(id)) continue
    const produced = registered.get(id).factory(makeRequire)
    exportsMap.set(id, produced)
  }
  return { exports: exportsMap, requested }
}

/** Every specifier the shell can serve without a package factory. */
export { SEEDS }
