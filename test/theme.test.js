import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/**
 * The design-platform tokens the panel is allowed to use.
 *
 * Keeping the list here means a newly invented token, or a host token this
 * plugin does not actually use, fails the suite instead of drifting.
 */
const ALLOWED_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-focus-ring-color',
  '--dsw-focus-ring-width',
  '--dsw-radius-lg',
  '--dsw-radius-md',
  '--dsw-radius-sm',
  '--dsw-radius-xl',
  '--dsw-radius-xs',
  '--dsw-shadow-lv3',
  '--dsw-static-deepseek-400',
])

describe('panel theming', () => {
  it('uses no literal color values', () => {
    const hex = [...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])
    assert.deepEqual(hex, [], 'literal hex colors: ' + hex.join(', '))
    assert.equal(/\brgba?\(/.test(source), false, 'literal rgb()/rgba() values')
  })

  it('uses exactly the design-platform tokens it declares', () => {
    const used = new Set([...source.matchAll(/--dsw-[a-z0-9-]+/g)].map((match) => match[0]))
    const unexpected = [...used].filter((token) => !ALLOWED_TOKENS.has(token))
    const unused = [...ALLOWED_TOKENS].filter((token) => !used.has(token))
    assert.deepEqual(unexpected, [], 'tokens that do not exist in the design platform')
    assert.deepEqual(unused, [], 'declared tokens the panel does not use')
  })

  it('does not use the obsolete token names', () => {
    for (const token of [
      '--dsw-alias-border-secondary',
      '--dsw-alias-label-inverse',
      '--dsw-alias-surface-overlay',
      '--dsw-alias-surface-sunken',
    ]) {
      assert.equal(source.includes(token), false, 'unknown token ' + token)
    }
  })

  it('animates progress and fades the toast, with a reduced-motion guard', () => {
    assert.match(source, /\.updater-spinner \{[^}]*animation: updater-spin/)
    assert.match(source, /updater-toast-fade/)
    assert.match(source, /prefers-reduced-motion[\s\S]*\.updater-spinner \{ animation: none; \}/)
  })
})
