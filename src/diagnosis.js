/**
 * Turning a settled update into the facts a row can show.
 *
 * Every failure path of the plugin manager reports the same two things — a
 * `code` the caller can branch on and an optional `diagnostic` — and most also
 * carry the package manager's own output. The registry path nests them under
 * `result` and its rollback under `result.restore`; the git path reports the
 * target under `result` and the reinstallation under `restore`; and a rejected
 * call arrives as the error itself. Reading those shapes belongs in one pure
 * place, not in the browser.
 * @module dsh-plugin-updater/diagnosis
 */

/** Longest package manager excerpt a row carries, in characters. */
export const OUTPUT_LIMIT = 8000

/**
 * Keep the tail of a package manager run, which is where the failure is.
 * @param {unknown} packageResult The run result.
 * @returns {{text: string, truncated: boolean, exitCode?: number}|undefined}
 *   The excerpt, or undefined when there is nothing to show.
 */
export function trimOutput(packageResult) {
  const output = typeof packageResult === 'object' && packageResult !== null
    ? /** @type {{output?: unknown, exitCode?: unknown}} */ (packageResult)
    : undefined
  const text = typeof output?.output === 'string' ? output.output : ''
  if (text === '') return undefined
  const exitCode = typeof output.exitCode === 'number' ? output.exitCode : undefined
  const tail = text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text
  return {
    text: tail,
    truncated: text.length > OUTPUT_LIMIT,
    ...exitCode === undefined ? {} : { exitCode },
  }
}

/**
 * The change that holds the target attempt, and the one that holds a rollback.
 *
 * The git path reports them at the top level of the plugin's outcome; the
 * registry path nests the Host result one level deeper, with its own `restore`.
 * @param {object|undefined} result Settled update.
 * @returns {{target: object|undefined, recovery: object|undefined}} The attempts.
 */
function attemptsOf(result) {
  const settled = /** @type {{
   *   result?: {application?: string, error?: object, restore?: object, result?: {application?: string, error?: object, restore?: object}},
   *   restore?: {application?: string, error?: object}
   * }} */ (result ?? {})
  const registry = settled.result
  const nested = registry?.result
  return {
    target: nested === undefined ? registry : nested,
    recovery: settled.restore ?? registry?.restore,
  }
}

/**
 * The package manager output attached to a settled update, whichever path
 * produced it.
 * @param {object|undefined} result Settled update.
 * @returns {{text: string, truncated: boolean, exitCode?: number}|undefined} Its output.
 */
export function outputOf(result) {
  const settled = /** @type {{packageResult?: object, output?: object}} */ (result ?? {})
  const { target, recovery } = attemptsOf(result)
  return trimOutput(/** @type {{packageResult?: object}} */ (target ?? {}).packageResult)
    ?? trimOutput(/** @type {{packageResult?: object}} */ (recovery ?? {}).packageResult)
    ?? trimOutput(settled.packageResult)
    ?? (typeof settled.output === 'object' && settled.output !== null
      ? /** @type {{text: string, truncated: boolean, exitCode?: number}} */ (settled.output)
      : undefined)
}

/**
 * The error a settled update reported, whichever path reported it.
 * @param {object|undefined} result Settled update.
 * @returns {{code?: string, diagnostic?: string, incompatible?: object[]}} The error.
 */
export function errorOf(result) {
  const settled = /** @type {{error?: object}} */ (result ?? {})
  const { target } = attemptsOf(result)
  const reported = /** @type {{error?: object}} */ (target ?? {}).error
    ?? /** @type {{error?: object}} */ (settled.restore ?? {}).error
    ?? settled.error
  if (reported !== undefined) return /** @type {{code?: string, diagnostic?: string, incompatible?: object[]}} */ (reported)
  // A rejected call reports the thrown error itself as the attempt.
  return /** @type {{code?: string, diagnostic?: string, incompatible?: object[]}} */ (
    isErrorLike(target) ? target : {}
  )
}

/**
 * The failure the host reported, in the shape a row renders.
 *
 * `restored` says whether the previous version is back in place: a failed
 * attempt that never removed the package leaves the previous version running
 * just as a restored one does, and the user needs to know which happened.
 * A failed rollback carries its own diagnosis, because the reason the update
 * failed and the reason the recovery failed are different problems.
 * @param {object|undefined} result Settled update.
 * @returns {{
 *   code?: string, diagnostic?: string, output?: object, restored: boolean,
 *   recovery?: {code?: string, diagnostic?: string}
 * }} The failure facts, with every field the host did not report absent.
 */
export function describeFailure(result) {
  const error = errorOf(result)
  const code = typeof error.code === 'string' ? error.code : undefined
  const diagnostic = diagnosticOf(error)
  const output = outputOf(result)
  const { recovery } = attemptsOf(result)
  const rollbackOk = recovery !== undefined
    && recovery.application !== 'failed'
    && recovery.application !== 'cancelled'
  return {
    ...code === undefined ? {} : { code },
    ...diagnostic === undefined ? {} : { diagnostic },
    ...output === undefined ? {} : { output },
    restored: rollbackOk,
    ...recovery === undefined || rollbackOk ? {} : { recovery: diagnosisOf(recovery) },
  }
}

/**
 * One line naming the cause, or undefined when the host named none.
 *
 * The code comes first so it survives a diagnostic that is a wall of package
 * manager text, and an incompatible version names the requirement that failed:
 * "incompatible-version" alone does not tell the user what to upgrade.
 * @param {object|undefined} result Settled update.
 * @returns {string|undefined} The reason.
 */
export function describeReason(result) {
  const failure = describeFailure(result)
  const requirement = incompatibleRequirement(
    /** @type {{incompatible?: unknown}} */ (errorOf(result)).incompatible,
  )
  const parts = [failure.diagnostic, requirement].filter((part) => typeof part === 'string' && part !== '')
  if (failure.code !== undefined && parts.length > 0) return failure.code + ': ' + parts.join('; ')
  if (failure.code !== undefined) return failure.code
  return parts.length === 0 ? undefined : parts.join('; ')
}

/**
 * The readable facts of one change result.
 * @param {unknown} change A plugin manager change.
 * @returns {{code?: string, diagnostic?: string}} Its diagnosis.
 */
function diagnosisOf(change) {
  const error = /** @type {{code?: string, diagnostic?: string}} */ (
    typeof change === 'object' && change !== null
      ? (/** @type {{error?: object}} */ (change).error ?? change)
      : {}
  )
  const code = typeof error.code === 'string' ? error.code : undefined
  const diagnostic = diagnosticOf(error)
  return {
    ...code === undefined ? {} : { code },
    ...diagnostic === undefined ? {} : { diagnostic },
  }
}

/**
 * Whether a settled change is itself the thrown failure.
 * @param {unknown} value The candidate.
 * @returns {boolean} True for an error-like value.
 */
function isErrorLike(value) {
  if (value === null || typeof value !== 'object') return false
  const candidate = /** @type {{code?: unknown, diagnostic?: unknown}} */ (value)
  return value instanceof Error || typeof candidate.code === 'string' || typeof candidate.diagnostic === 'string'
}

/**
 * The diagnostic text of one error, including a thrown error's message.
 * @param {unknown} error Host error.
 * @returns {string|undefined} Its text.
 */
function diagnosticOf(error) {
  const candidate = /** @type {{diagnostic?: unknown}} */ (error ?? {})
  if (typeof candidate.diagnostic === 'string' && candidate.diagnostic !== '') return candidate.diagnostic
  if (error instanceof Error && error.message !== '') return error.message
  return undefined
}

/**
 * The requirement an incompatible version failed.
 *
 * The Host keys the unmet requirements by `engines.dsh` or by peer package
 * name, so the value is a record, not a list; a list is still accepted because
 * a caller may normalise it first.
 * @param {unknown} incompatible Packages the running DSH rejected.
 * @returns {string|undefined} The requirement text.
 */
function incompatibleRequirement(incompatible) {
  const first = Array.isArray(incompatible) ? incompatible[0] : undefined
  if (first === undefined) return undefined
  const entry = /** @type {{name?: string, runtimeVersion?: string, requirements?: unknown}} */ (first)
  const required = requirementList(entry.requirements)
  if (required.length === 0) return undefined
  const text = required.join(', ')
  if (entry.name !== undefined && entry.runtimeVersion !== undefined) {
    return entry.name + ' requires ' + text + '; this Harness runs ' + entry.runtimeVersion
  }
  return 'requires ' + text
}

/**
 * Flatten a requirements record or list into readable entries.
 * @param {unknown} requirements Host requirements.
 * @returns {string[]} One entry per unmet requirement.
 */
function requirementList(requirements) {
  if (Array.isArray(requirements)) return requirements.filter((text) => typeof text === 'string')
  if (requirements === null || typeof requirements !== 'object') return []
  return Object.entries(/** @type {Record<string, unknown>} */ (requirements))
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => (key === '' ? String(value) : key + ' ' + String(value)))
}
