/**
 * Reading and normalising the plugin's persisted configuration.
 *
 * The two lists — trusted repositories and ignored updates — are the only state
 * this plugin persists. Everything else (the last check result, which plugins
 * await a restart) is in memory: it is derived, and a restart recomputes it.
 *
 * Values are normalised on every read, so a hand-edited patch row, an entry from
 * an older version, or a malformed value degrades to a usable list instead of
 * breaking a check.
 * @module dsh-plugin-updater/config
 */

import { normaliseIgnored } from './ignore.js'
import { normaliseTrusted } from './trust.js'

/**
 * Read the configuration into its normalised form.
 * @param {unknown} raw Row configuration.
 * @returns {{trustedRepositories: string[], ignoredUpdates: {name: string, identity: string}[]}}
 *   Only well-formed entries.
 */
export function readConfig(raw) {
  const value = typeof raw === 'object' && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {}
  return {
    trustedRepositories: normaliseTrusted(value.trustedRepositories),
    ignoredUpdates: normaliseIgnored(value.ignoredUpdates),
  }
}

/**
 * Merge a replacement into a configuration, keeping the other list.
 * @param {unknown} raw Current row configuration.
 * @param {{trustedRepositories?: unknown, ignoredUpdates?: unknown}} patch Replacement values.
 * @returns {{trustedRepositories: string[], ignoredUpdates: {name: string, identity: string}[]}}
 *   The merged, normalised configuration.
 */
export function mergeConfig(raw, patch) {
  const current = readConfig(raw)
  const next = typeof raw === 'object' && raw !== null ? { .../** @type {Record<string, unknown>} */ (raw) } : {}
  next.trustedRepositories = patch.trustedRepositories === undefined
    ? current.trustedRepositories
    : normaliseTrusted(patch.trustedRepositories)
  next.ignoredUpdates = patch.ignoredUpdates === undefined
    ? current.ignoredUpdates
    : normaliseIgnored(patch.ignoredUpdates)
  return readConfig(next)
}
