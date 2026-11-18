/**
 * Applying an update.
 *
 * A registry update delegates to the host, which already validates
 * compatibility and restores the previous version on failure. A git update tries
 * to install the new commit over the running package first and only removes it
 * when the host refuses that — the refusal is how a host that is executing a
 * bundle protects it. The interesting part is not installing but coming back:
 * a failed reinstallation must never be reported as a successful restoration,
 * and the saved dependency spec must end exactly as it began, because a spec
 * left pinned to a commit makes later detection compare that commit with itself
 * and report "current" forever.
 * @module dsh-plugin-updater/apply
 */

import { describeReason } from './diagnosis.js'
import { movingSpec, pinnedSpec } from './spec.js'

/**
 * Save a dependency value back to its original form.
 *
 * The host writes the profile manifest during installation, always with the
 * spec it was given, so the original value is restored explicitly afterwards.
 * @param {{
 *   profileDir: string,
 *   name: string,
 *   saved: string
 * }} input What to restore.
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>} Whether the restore succeeded.
 */
export async function restoreSavedSpec(input) {
  // The signature promises a result, and this runs inside the recovery path: a
  // rejection here would replace the report of what went wrong with a parse
  // error, and leave a pinned spec behind without saying so.
  try {
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = join(input.profileDir, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    const dependencies = manifest.dependencies ?? {}
    if (dependencies[input.name] === input.saved) return { ok: true }
    dependencies[input.name] = input.saved
    manifest.dependencies = dependencies
    await writeFile(path, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Update a git-installed plugin.
 *
 * The pinned commit is installed over the running package first. A host that is
 * executing the bundle refuses that attempt before the package manager runs, and
 * only that refusal removes the package and retries. Any other failure stops
 * with the diagnosis and leaves the running package untouched. An explicit
 * approval decision arrives as `initialApproval`, so an already-authorised
 * replay does not start with an install the user already rejected.
 * @param {{
 *   name: string,
 *   repository: string,
 *   saved: string,
 *   previousCommit?: string,
 *   targetCommit: string,
 *   profileDir: string,
 *   host: {
 *     removeBundle: (name: string) => Promise<object>,
 *     installBundle: (spec: string, options?: object) => Promise<object>
 *   },
 *   decideApproval?: (failure: object) => Promise<{decision: 'none'|'approve'|'ask', keys: string[]}>,
 *   approveBuilds?: (keys: string[], spec: string) => Promise<object>,
 *   initialApproval?: string[],
 *   signal?: AbortSignal,
 *   requestId?: string,
 *   onPhase?: (phase: string) => void
 * }} input Candidate facts and host capabilities.
 * @returns {Promise<{
 *   outcome: 'updated'|'restored'|'failed'|'cancelled'|'needsApproval',
 *   step: 'remove'|'install'|'restore',
 *   result?: object,
 *   restore?: object,
 *   approvedBuilds?: string[],
 *   needsApproval?: string[],
 *   reason?: string
 * }>} The outcome, naming the last step that ran.
 */
export async function updateGit(input) {
  const announce = (phase) => input.onPhase?.(phase)
  const aborted = () => input.signal?.aborted === true
  const approved = Array.isArray(input.initialApproval) ? input.initialApproval : []

  if (aborted()) return cancelled('cancelled before installing')

  announce('installing')
  const first = await install(input, input.targetCommit, approved)
  if (succeeded(first)) return finished(input, first, approved)
  if (cancelledByHost(first) || aborted()) return cancelled()
  // Only the host's refusal to install over an installed package leads to a
  // removal. A network, package manager, or compatibility failure means the
  // target is not installable, and removing the working package would turn that
  // into an absence.
  if (!refusedAsInstalled(first)) return resolveFailure(input, first, false, approved)

  return removeAndInstall(input, first, approved)
}

/**
 * Remove the installed package and install the target again.
 *
 * Reachable in two cases only: the host refused the install-over attempt, or an
 * approved replay was refused the same way. Every path returns the saved spec
 * to its original form.
 * @param {object} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object, reason?: string}} cause The refusal.
 * @param {string[]} approved Approved entries to install with, unreachable without a decision.
 * @returns {Promise<object>} The outcome.
 */
async function removeAndInstall(input, cause, approved) {
  const aborted = () => input.signal?.aborted === true
  const announce = (phase) => input.onPhase?.(phase)
  if (aborted()) return cancelled('cancelled before installing')

  announce('removing')
  const removal = await settle(() => input.host.removeBundle(input.name))
  if (!succeeded(removal)) {
    const reverted = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
    return {
      outcome: 'failed',
      step: 'remove',
      result: removal.value,
      reason: describeReason(removal.value) ?? reasonOf(removal),
      ...reverted.ok ? {} : { specRestoreFailed: reverted.reason },
    }
  }

  if (aborted()) return cancelled(undefined, await restore(input, cause))

  announce('installing')
  const retry = await install(input, input.targetCommit, approved)
  if (succeeded(retry)) return finished(input, retry, approved)
  if (cancelledByHost(retry) || aborted()) return cancelled(undefined, await restore(input, retry))
  // The approval was already granted for this install, so another decision would
  // be the same answer; the failure is final for this attempt.
  if (approved.length > 0) return recoveryOutcome(input, await restore(input, retry), retry, approved)
  return resolveFailure(input, retry, true, approved)
}

/**
 * Decide what a failed attempt becomes: an approval request, an approval
 * replay, a restoration, or a reported failure.
 *
 * An approval replay happens before any removal, so a blocked build script never
 * costs the running package; only an attempt that removed it is restored.
 * @param {object} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object, reason?: string}} cause The failed attempt.
 * @param {boolean} afterRemoval Whether the package is currently absent.
 * @param {string[]} approved Entries already authorised by the user.
 * @returns {Promise<object>} The outcome.
 */
async function resolveFailure(input, cause, afterRemoval, approved) {
  if (input.signal?.aborted === true) return cancelled(undefined, afterRemoval ? await restore(input, cause) : undefined)
  const approval = approved.length > 0
    ? { decision: 'approve', keys: approved }
    : input.decideApproval === undefined
      ? { decision: 'none', keys: [] }
      : await input.decideApproval(cause)
  if (approval.decision === 'approve' && approval.keys.length > 0 && input.approveBuilds !== undefined) {
    if (input.signal?.aborted === true) return cancelled(undefined, afterRemoval ? await restore(input, cause) : undefined)
    input.onPhase?.('approving')
    // Approving through the host both records the key and performs the install,
    // so its result is the installation attempt rather than a separate retry.
    const replay = await settle(() => input.approveBuilds(approval.keys, pinnedSpec(input.repository, input.targetCommit)))
    if (succeeded(replay)) return finished(input, replay, approval.keys)
    if (cancelledByHost(replay) || input.signal?.aborted === true) {
      return cancelled(undefined, afterRemoval ? await restore(input, replay) : undefined)
    }
    // The host can refuse the replay because the package is still installed;
    // that is the one refusal a removal may answer, even after a user decision.
    if (!afterRemoval && refusedAsInstalled(replay)) return removeAndInstall(input, replay, approval.keys)
    if (afterRemoval) return recoveryOutcome(input, await restore(input, replay), replay, approval.keys)
    return failedAttempt(input, replay, approval.keys)
  }

  if (approval.decision === 'ask') {
    const reason = approval.keys.length === 0 ? undefined : `build approval needed for ${approval.keys.join(', ')}`
    if (!afterRemoval) {
      // Nothing was removed, so the running package needs no restoration: the
      // question is asked over a package that still works.
      const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
      return {
        outcome: 'needsApproval', step: 'install',
        needsApproval: approval.keys,
        ...reason === undefined ? {} : { reason },
        ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
      }
    }
    // The plugin is currently absent, so it is restored before the user is asked:
    // a pending question must not leave an installed plugin missing.
    input.onPhase?.('restoring')
    const recovery = await restore(input, cause)
    return {
      outcome: 'needsApproval', step: 'restore', ...recoveryFields(recovery),
      needsApproval: approval.keys,
      ...reason === undefined ? {} : { reason },
    }
  }

  if (!afterRemoval) return failedAttempt(input, cause, approved)
  return recoveryOutcome(input, await restore(input, cause), cause, approved)
}

/**
 * Report a failed attempt that never removed the installed package.
 * @param {object} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object, reason?: string}} cause The failed attempt.
 * @param {string[]} [approved] Entries the host may have recorded before failing.
 * @returns {Promise<object>} The outcome.
 */
async function failedAttempt(input, cause, approved = []) {
  const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
  return {
    outcome: 'failed',
    step: 'install',
    result: cause.value,
    ...approvedSuffix(cause.value, approved),
    reason: describeReason(cause.value) ?? reasonOf(cause),
    ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
  }
}

/**
 * Report a successful installation and leave the dependency following HEAD.
 * @param {object} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object}} cause The applied attempt.
 * @param {string[]} [approved] Entries the host recorded for this installation.
 * @returns {Promise<object>} The outcome.
 */
async function finished(input, cause, approved = []) {
  const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
  return {
    outcome: 'updated',
    step: 'install',
    result: cause.value,
    ...approvedSuffix(cause.value, approved),
    ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
  }
}

/**
 * Report the outcome of a failed attempt together with its recovery.
 *
 * A recovery that failed is reported as a failure, never as a restoration: the
 * user must learn both that the update did not apply and that the previous
 * version could not be brought back.
 * @param {object} input Candidate facts and host capabilities.
 * @param {{restore?: object, restored: boolean, reason?: string, specRestoreFailed?: string}} recovery
 *   The reinstallation outcome.
 * @param {{ok: boolean, value?: object, reason?: string}} cause The failed attempt.
 * @param {string[]} [approved] Entries the host recorded before failing.
 * @returns {object} The outcome.
 */
function recoveryOutcome(input, recovery, cause, approved = []) {
  const fields = {
    ...recoveryFields(recovery),
    ...approvedSuffix(cause.value, approved),
  }
  if (recovery.restored) {
    return {
      outcome: 'restored',
      step: 'restore',
      ...fields,
      ...cause?.reason === undefined ? {} : { reason: cause.reason },
    }
  }
  return {
    outcome: 'failed',
    step: 'restore',
    result: cause.value,
    ...fields,
    reason: recovery.reason ?? describeReason(cause.value) ?? reasonOf(cause),
  }
}

/**
 * Build an outcome for a cancelled attempt.
 * @param {string} [reason] Why it was cancelled.
 * @param {{restore?: object, restored: boolean, reason?: string, specRestoreFailed?: string}} [recovery]
 *   The reinstallation outcome, when the package had been removed.
 * @returns {object} The outcome.
 */
function cancelled(reason, recovery) {
  return {
    outcome: 'cancelled',
    step: recovery === undefined ? 'install' : 'restore',
    ...recovery === undefined ? {} : recoveryFields(recovery),
    ...reason === undefined ? {} : { reason },
  }
}

/**
 * The fields a recovery contributes to an outcome.
 * @param {{restore?: object, restored?: boolean, reason?: string, specRestoreFailed?: string}} recovery
 *   The reinstallation outcome.
 * @returns {object} Its fields.
 */
function recoveryFields(recovery) {
  return {
    ...recovery.restore === undefined ? {} : { restore: recovery.restore },
    ...recovery.reason === undefined ? {} : { reason: recovery.reason },
    ...recovery.specRestoreFailed === undefined ? {} : { specRestoreFailed: recovery.specRestoreFailed },
  }
}

/**
 * The approved entries the host recorded for one attempt, for the audit log.
 * @param {unknown} change The plugin manager change.
 * @param {string[]} approved Entries this attempt asked to approve.
 * @returns {{approvedBuilds?: string[]}} The field, when the host confirmed any.
 */
function approvedSuffix(change, approved) {
  const recorded = /** @type {{approvedBuilds?: unknown}} */ (change ?? {})
  const keys = Array.isArray(recorded.approvedBuilds)
    ? recorded.approvedBuilds.filter((key) => typeof key === 'string')
    : approved
  return keys.length === 0 ? {} : { approvedBuilds: [...keys] }
}

/**
 * Install one exact commit over whatever is installed.
 * @param {{host: object, name: string, repository: string}} input Host and target.
 * @param {string} commit Commit to install.
 * @param {string[]} [approved] Build entries the user already allowed.
 * @returns {Promise<{ok: boolean, value?: object, reason?: string}>} The outcome.
 */
async function install(input, commit, approved = []) {
  return settle(() => input.host.installBundle(pinnedSpec(input.repository, commit), {
    saveExact: true, enabled: true,
    ...input.requestId === undefined ? {} : { requestId: input.requestId },
    ...approved.length === 0 ? {} : { approvedBuilds: approved },
  }))
}

/**
 * Whether the host refused an attempt because the package is already installed.
 *
 * That refusal is the only signal that this host cannot install over the running
 * package; a thrown failure carries the same code on the error itself.
 * @param {{ok: boolean, value?: object}} result A settled attempt.
 * @returns {boolean} True when it was that refusal.
 */
function refusedAsInstalled(result) {
  const value = /** @type {{error?: {code?: string}, code?: string}} */ (result.value ?? {})
  return value.error?.code === 'already-installed' || value.code === 'already-installed'
}

/**
 * Whether the host reported that the attempt itself was cancelled.
 * @param {{ok: boolean, value?: object}} result A settled attempt.
 * @returns {boolean} True when the host cancelled it.
 */
function cancelledByHost(result) {
  return /** @type {{application?: string}} */ (result.value ?? {}).application === 'cancelled'
}

/**
 * Reinstall the previously installed commit and return the saved spec to its
 * original value.
 *
 * The reinstallation deliberately carries no request id: cancelling the update
 * must not be able to stop the recovery, which would leave the plugin absent.
 * @param {{
 *   name: string,
 *   repository: string,
 *   saved: string,
 *   previousCommit?: string,
 *   profileDir: string,
 *   host: object
 * }} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object, reason?: string}} [cause] The failure being recovered from.
 * @returns {Promise<{
 *   restore?: object, restored: boolean, reason?: string, specRestoreFailed?: string
 * }>} The reinstallation outcome.
 */
async function restore(input, cause) {
  // With no recorded previous commit there is nothing to pin, so the moving
  // spec is the best available attempt to come back to a working state.
  const spec = input.previousCommit === undefined
    ? movingSpec(input.repository)
    : pinnedSpec(input.repository, input.previousCommit)
  const outcome = await settle(() => input.host.installBundle(spec, {
    saveExact: true, enabled: true,
  }))
  const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
  const restored = succeeded(outcome)
  const recovery = `reinstall ${spec} to recover`
  const caused = cause?.reason === undefined ? '' : ` (${cause.reason})`
  // A spec that could not be restored is part of what went wrong, not a detail:
  // while it is pinned, detection compares that commit with itself.
  const pinned = unfixed.ok ? '' : `; the saved spec also could not be restored (${unfixed.reason}) while it may be pinned`
  if (restored) {
    return {
      restore: outcome.value,
      restored: true,
      ...cause?.reason === undefined ? {} : { reason: cause.reason },
      ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
    }
  }
  return {
    restore: outcome.value,
    restored: false,
    reason: `could not restore ${input.name}${caused}; ${recovery}${pinned}`,
  }
}

/**
 * Update a registry-installed plugin through the host's own update path.
 * @param {{
 *   name: string,
 *   version: string,
 *   registry?: string|null,
 *   host: {updateBundle: (name: string, version: string, options?: object) => Promise<object>},
 *   requestId?: string,
 *   onPhase?: (phase: string) => void
 * }} input Candidate facts and host capability.
 * @returns {Promise<{outcome: 'updated'|'restored'|'failed', step: 'install', result?: object, reason?: string}>}
 *   The outcome.
 */
export async function updateRegistry(input) {
  input.onPhase?.('installing')
  const options = {
    ...input.requestId === undefined ? {} : { requestId: input.requestId },
    // `null` is meaningful to the Host — it asks pnpm's own registry — while an
    // absent value asks the remembered or configured one, so both are passed on.
    ...input.registry === undefined ? {} : { registry: input.registry },
  }
  const result = await settle(() => input.host.updateBundle(
    input.name,
    input.version,
    Object.keys(options).length === 0 ? undefined : options,
  ))
  if (!result.ok) {
    return {
      outcome: 'failed',
      step: 'install',
      ...result.value === undefined ? {} : { result: result.value },
      reason: describeReason(result.value) ?? result.reason,
    }
  }
  // The host nests this outcome one level deeper on the registry path.
  const application = /** @type {{result?: {application?: string}, restore?: {application?: string}}} */ (result.value)?.result?.application
  if (application === 'cancelled') {
    return { outcome: 'cancelled', step: 'install', result: result.value }
  }
  if (application === 'failed') {
    const rollback = /** @type {{application?: string}|undefined} */ (
      /** @type {{restore?: {application?: string}}} */ (result.value).restore
    )
    const rollbackOk = rollback !== undefined && rollback.application !== 'failed' && rollback.application !== 'cancelled'
    const target = describeReason(result.value)
    const recovery = rollbackOk || rollback === undefined ? undefined : describeReason(result.value.restore)
    return {
      outcome: rollbackOk ? 'restored' : 'failed',
      step: 'install',
      result: result.value,
      reason: [target, recovery === undefined ? undefined : `the previous version could not be restored (${recovery})`]
        .filter((part) => typeof part === 'string' && part !== '')
        .join('; ') || undefined,
    }
  }
  return { outcome: 'updated', step: 'install', result: result.value }
}

/**
 * Reload a plugin installed from a local directory.
 *
 * Nothing is reinstalled: the directory is the package, so only the loaded
 * module is stale.
 * @param {{
 *   name: string,
 *   host: {setBundleEnabled: (name: string, enabled: boolean) => Promise<object>},
 *   onPhase?: (phase: string) => void
 * }} input Candidate facts and host capability.
 * @returns {Promise<{outcome: 'reloaded'|'failed', step: 'reload', result?: object, reason?: string}>}
 *   The outcome.
 */
export async function reloadLocal(input) {
  input.onPhase?.('reloading')
  const off = await settle(() => input.host.setBundleEnabled(input.name, false))
  if (!succeeded(off)) {
    return { outcome: 'failed', step: 'reload', result: off.value, reason: describeReason(off.value) ?? reasonOf(off) }
  }
  const on = await settle(() => input.host.setBundleEnabled(input.name, true))
  if (!succeeded(on)) {
    return { outcome: 'failed', step: 'reload', result: on.value, reason: describeReason(on.value) ?? reasonOf(on) }
  }
  return { outcome: 'reloaded', step: 'reload', result: on.value }
}

/**
 * Run a promise into a result rather than a rejection.
 * @param {() => Promise<object>} operation The operation.
 * @returns {Promise<{ok: boolean, value?: object, reason?: string, error?: unknown}>} Its outcome.
 *   `error` keeps the thrown value, which carries facts the reason text cannot,
 *   such as the pending build scripts a failed installation reported.
 */
async function settle(operation) {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error : undefined,
      value: typeof error === 'object' && error !== null ? /** @type {object} */ (error) : undefined,
    }
  }
}

/**
 * Whether a settled installation actually applied.
 *
 * A host change resolves rather than throws when it fails, so the application
 * field is the only evidence of success. A cancelled change is not a success
 * either.
 * @param {{ok: boolean, value?: object}} result A settled outcome.
 * @returns {boolean} True only when the change applied or scheduled a restart.
 */
function succeeded(result) {
  if (result.ok !== true) return false
  const application = /** @type {{application?: string}} */ (result.value ?? {}).application
  return application !== 'failed' && application !== 'cancelled'
}

/**
 * A readable reason from a settled outcome.
 * @param {{reason?: string}} result A settled outcome.
 * @returns {string|undefined} The reason.
 */
function reasonOf(result) {
  return result.reason
}
