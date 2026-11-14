import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { en } from '../src/strings.js'

/**
 * Flatten a locale document into dotted keys.
 * @param {unknown} value Locale value.
 * @param {string} [prefix] Key prefix.
 * @returns {Record<string, string>} Flat key to string.
 */
function flatten(value, prefix = '') {
  const flat = {}
  if (typeof value !== 'object' || value === null) return flat
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof child === 'string') flat[path] = child
    else Object.assign(flat, flatten(child, path))
  }
  return flat
}

const locale = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
const flat = flatten(locale)
const bundleSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/**
 * The keys the browser bundle's inline dictionary defines.
 * @returns {Set<string>} Dotted keys.
 */
function inlineKeys() {
  return new Set([...bundleSource.matchAll(/^ {6}'([a-zA-Z.]+)':/gm)].map((match) => match[1]))
}

/**
 * The keys the browser bundle looks up.
 * @returns {Set<string>} Dotted keys.
 */
function lookedUpKeys() {
  return new Set([...bundleSource.matchAll(/\bt\('([a-zA-Z.]+)'/g)].map((match) => match[1]))
}

describe('client strings', () => {
  it('has a display title and description for the bundle', () => {
    assert.equal(typeof locale.meta.title, 'string')
    assert.ok(locale.meta.title.length > 0)
    assert.equal(typeof locale.meta.description, 'string')
    assert.ok(locale.meta.description.length >= 50)
  })

  it('resolves every string the bundle looks up', () => {
    // A key the bundle asks for and does not define renders as the key itself,
    // which a user reads as gibberish. This is the check that catches it.
    const missing = [...lookedUpKeys()].filter((key) => !inlineKeys().has(key))
    assert.deepEqual(missing, [], `looked up but not defined in client.js: ${missing.join(', ')}`)
  })

  it('keeps the bundle dictionary in step with src/strings.js', () => {
    const bundleKeys = inlineKeys()
    const missing = Object.keys(en).filter((key) => !bundleKeys.has(key))
    assert.deepEqual(missing, [], `missing from client.js: ${missing.join(', ')}`)
  })

  it('has no bundle-only key that src/strings.js lacks', () => {
    // The reverse direction: a key added to the bundle and forgotten in the
    // source module is drift too, and the previous check could not see it.
    const extra = [...inlineKeys()].filter((key) => !(key in en))
    assert.deepEqual(extra, [], `only in client.js: ${extra.join(', ')}`)
  })

  it('has the same text for every key in both copies', () => {
    // A changed value is drift as much as a missing key: the bundle is what the
    // user reads, so the two must not disagree.
    const values = new Map([...bundleSource.matchAll(/^ {6}'([a-zA-Z.]+)': '((?:[^'\\]|\\.)*)'/gm)]
      .map((match) => [match[1], match[2].replace(/\\'/g, "'")]))
    const differing = Object.entries(en)
      .filter(([key, text]) => values.has(key) && values.get(key) !== text)
      .map(([key]) => key)
    assert.deepEqual(differing, [], `different text: ${differing.join(', ')}`)
  })

  it('does not leave an English key out of the locale file', () => {
    const missing = Object.keys(en).filter((key) => !(key in flat))
    assert.deepEqual(missing, [], `missing from locale/en.json: ${missing.join(', ')}`)
  })

  it('uses sentence case in user-facing labels', () => {
    // A proper noun or a placeholder value is not a sentence.
    const exempt = new Set(['row.sourceRegistry', 'settings.trustedPlaceholder'])
    for (const [key, text] of Object.entries(en)) {
      if (exempt.has(key)) continue
      assert.equal(text.charAt(0), text.charAt(0).toUpperCase(), `${key} should start with a capital letter`)
    }
  })

  it('interpolates only non-empty placeholders', () => {
    for (const [key, text] of Object.entries(en)) {
      for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
        assert.ok(match[1].length > 0, `${key} has an empty placeholder`)
      }
    }
  })

  it('has no unresolved template markers in plain text', () => {
    for (const [key, text] of Object.entries(en)) {
      assert.ok(!text.includes('<%'), `${key} still carries a template marker`)
    }
  })
})
