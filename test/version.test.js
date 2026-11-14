import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COUNT_LIMIT, compareVersions, formatCount, hasCount, isNewer, isVersion, parseVersion, pendingTotal, shortCommit,
} from '../src/version.js'

describe('parseVersion', () => {
  it('reads the three parts', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('reads a prerelease', () => {
    assert.deepEqual(parseVersion('0.2.2-rc.1').prerelease, ['rc', '1'])
  })

  it('refuses anything else', () => {
    for (const value of ['', 'latest', '1.2', undefined, null, 1.2]) assert.equal(parseVersion(value), undefined)
  })
})

describe('isVersion', () => {
  it('accepts a release and a prerelease', () => {
    assert.equal(isVersion('1.0.0'), true)
    assert.equal(isVersion('0.2.2-rc.1'), true)
  })

  it('refuses a range', () => {
    assert.equal(isVersion('^1.0.0'), false)
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    assert.ok(compareVersions('2.0.0', '1.9.9') > 0)
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0)
    assert.ok(compareVersions('1.0.1', '1.0.0') > 0)
  })

  it('reports equality', () => {
    assert.equal(compareVersions('0.34.0', '0.34.0'), 0)
  })

  it('ranks a release above its prerelease', () => {
    assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0)
  })

  it('ranks numeric prerelease identifiers numerically', () => {
    assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0)
  })

  it('returns undefined when a side is not a version', () => {
    assert.equal(compareVersions('^1.0.0', '1.0.0'), undefined)
  })
})

describe('isNewer', () => {
  it('is true only for a strictly newer version', () => {
    assert.equal(isNewer('0.35.0', '0.34.0'), true)
    assert.equal(isNewer('0.34.0', '0.34.0'), false)
    assert.equal(isNewer('0.33.0', '0.34.0'), false)
  })

  it('is false when either side does not parse', () => {
    assert.equal(isNewer('latest', '1.0.0'), false)
  })
})

describe('formatCount', () => {
  it('shows nothing at zero', () => {
    assert.equal(formatCount(0), '')
    assert.equal(formatCount(-1), '')
  })

  it('shows the number up to the limit', () => {
    assert.equal(formatCount(1), '1')
    assert.equal(formatCount(COUNT_LIMIT), '9')
  })

  it('collapses above the limit', () => {
    assert.equal(formatCount(COUNT_LIMIT + 1), '9+')
    assert.equal(formatCount(100), '9+')
  })

  it('ignores a non-finite value', () => {
    assert.equal(formatCount(Number.NaN), '')
  })
})

describe('hasCount', () => {
  it('agrees with formatCount', () => {
    assert.equal(hasCount(0), false)
    assert.equal(hasCount(3), true)
  })
})

describe('pendingTotal', () => {
  it('sums the three kinds', () => {
    assert.equal(pendingTotal({ updates: 2, reloads: 1, failed: 1 }), 4)
  })

  it('treats missing parts as zero', () => {
    assert.equal(pendingTotal({ updates: 2 }), 2)
    assert.equal(pendingTotal({}), 0)
  })

  it('never returns a negative total', () => {
    assert.equal(pendingTotal({ updates: -5 }), 0)
  })
})

describe('shortCommit', () => {
  it('takes seven characters', () => {
    assert.equal(shortCommit('7bfa1f9694b3d0aa'), '7bfa1f9')
  })

  it('returns empty for nothing usable', () => {
    assert.equal(shortCommit(''), '')
    assert.equal(shortCommit(undefined), '')
  })
})
