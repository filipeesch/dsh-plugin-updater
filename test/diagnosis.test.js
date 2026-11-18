import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeFailure, describeReason, trimOutput } from '../src/diagnosis.js'

describe('trimOutput', () => {
  it('returns undefined for a run without output', () => {
    assert.equal(trimOutput(undefined), undefined)
    assert.equal(trimOutput({}), undefined)
    assert.equal(trimOutput({ output: '' }), undefined)
  })

  it('keeps the tail and the exit code', () => {
    const long = 'x'.repeat(9000) + 'tail'
    const trimmed = trimOutput({ output: long, exitCode: 1 })
    assert.equal(trimmed.text.length, 8000)
    assert.equal(trimmed.text.endsWith('tail'), true)
    assert.equal(trimmed.truncated, true)
    assert.equal(trimmed.exitCode, 1)
  })

  it('keeps a short run whole', () => {
    assert.deepEqual(trimOutput({ output: 'boom' }), { text: 'boom', truncated: false })
  })
})

describe('describeFailure', () => {
  it('reads the nested registry shape', () => {
    const failure = describeFailure({
      outcome: 'failed',
      result: {
        application: 'failed',
        error: { code: 'operation-error', diagnostic: 'ERR_PNPM_NO_MATCHING_VERSION' },
        packageResult: { output: 'pnpm failed', exitCode: 1 },
      },
    })
    assert.equal(failure.code, 'operation-error')
    assert.equal(failure.diagnostic, 'ERR_PNPM_NO_MATCHING_VERSION')
    assert.equal(failure.output.text, 'pnpm failed')
    assert.equal(failure.restored, false)
  })

  it('descends into the registry nesting', () => {
    const failure = describeFailure({
      outcome: 'failed',
      result: {
        result: {
          application: 'failed',
          error: { code: 'incompatible-version' },
          packageResult: { output: 'refused', exitCode: 1 },
        },
      },
    })
    assert.equal(failure.code, 'incompatible-version')
    assert.equal(failure.output.text, 'refused')
  })

  it('reads a thrown management failure kept as the result', () => {
    const failure = describeFailure({
      outcome: 'failed',
      result: Object.assign(new Error('already-installed'), { code: 'already-installed' }),
    })
    assert.equal(failure.code, 'already-installed')
    assert.equal(failure.diagnostic, 'already-installed')
  })

  it('reads a thrown failure', () => {
    const failure = describeFailure({ outcome: 'failed', error: Object.assign(new Error('lock timeout'), { code: 'operation-error' }) })
    assert.equal(failure.code, 'operation-error')
    assert.equal(failure.diagnostic, 'lock timeout')
  })

  it('reports a restore and takes output from the recovery', () => {
    const failure = describeFailure({
      outcome: 'restored',
      result: { application: 'failed', error: { code: 'already-installed' } },
      restore: { application: 'applied', packageResult: { output: 'reinstalled' } },
    })
    assert.equal(failure.code, 'already-installed')
    assert.equal(failure.restored, true)
    assert.equal(failure.output.text, 'reinstalled')
  })

  it('omits what the host did not report', () => {
    const failure = describeFailure({ outcome: 'failed' })
    assert.equal('code' in failure, false)
    assert.equal('diagnostic' in failure, false)
    assert.equal('output' in failure, false)
    assert.equal(failure.restored, false)
  })
})

describe('describeReason', () => {
  it('puts the code before the diagnostic', () => {
    assert.equal(
      describeReason({ result: { error: { code: 'operation-error', diagnostic: 'registry unreachable' } } }),
      'operation-error: registry unreachable',
    )
  })

  it('names the requirement an incompatible version failed, in the Host record shape', () => {
    const reason = describeReason({
      result: {
        result: {
          error: {
            code: 'incompatible-version',
            incompatible: [{
              name: 'dsh-subscriptions',
              version: '0.3.7',
              runtimeVersion: '0.2.2-rc.3',
              requirements: { '@deepseek-ai/dsh-web': '>=0.3.0', 'engines.dsh': '>=0.3.0' },
            }],
          },
        },
      },
    })
    assert.match(reason, /incompatible-version/)
    assert.equal(reason.includes('requires @deepseek-ai/dsh-web >=0.3.0'), true)
    assert.equal(reason.includes('engines.dsh >=0.3.0'), true)
    assert.equal(reason.includes('runs 0.2.2-rc.3'), true)
  })

  it('reports a failed rollback with its own diagnosis', () => {
    const failure = describeFailure({
      outcome: 'failed',
      result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'target failed' } },
      restore: { application: 'failed', error: { code: 'operation-error', diagnostic: 'rollback failed' } },
    })
    assert.equal(failure.restored, false)
    assert.equal(failure.code, 'operation-error')
    assert.equal(failure.diagnostic, 'target failed')
    assert.equal(failure.recovery.diagnostic, 'rollback failed')
  })

  it('reads the registry rollback one level deeper', () => {
    const failure = describeFailure({
      outcome: 'failed',
      result: {
        result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'target failed' } },
        restore: { application: 'applied' },
      },
    })
    assert.equal(failure.restored, true)
    assert.equal('recovery' in failure, false)
  })

  it('is undefined when the host named nothing', () => {
    assert.equal(describeReason({ outcome: 'failed' }), undefined)
  })
})
