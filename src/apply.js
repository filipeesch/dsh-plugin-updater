/**
 * Applying an update.
 *
 * A registry update delegates to the host, which already validates
 * compatibility and restores the previous version on failure. A git update has
 * to be composed from removal and installation, and the interesting part is not
 * installing but coming back: the saved dependency spec must end exactly as it
 * began, because a spec left pinned to a commit makes later detection compare
 * that commit with itself and report "current" forever.
 * @module dsh-plugin-updater/apply
 */

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
 * Order matters. The package is removed first because the host refuses to
 * replace an installed bundle while hot reload is available, so the previous
 * commit is captured before anything changes. Every exit — success, failure, or
 * cancellation — returns the saved spec to its original form.
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
 *   signal?: AbortSignal,
 *   onPhase?: (phase: string) => void
 * }} input Candidate facts and host capabilities.
 * @returns {Promise<{
 *   outcome: 'updated'|'restored'|'failed'|'cancelled'|'needsApproval',
 *   step: 'remove'|'install'|'restore',
 *   result?: object,
 *   restore?: object,
 *   approved?: string[],
 *   needsApproval?: string[],
 *   reason?: string
 * }>} The outcome, naming the last step that ran.
 */
export async function updateGit(input) {
  const announce = (phase) => input.onPhase?.(phase)
  const aborted = () => input.signal?.aborted === true

  announce('removing')
  const removal = await settle(() => input.host.removeBundle(input.name))
  if (!succeeded(removal)) {
    const reverted = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
    return {
      outcome: 'failed',
      step: 'remove',
      result: removal.value,
      reason: reasonOf(removal),
      ...reverted.ok ? {} : { specRestoreFailed: reverted.reason },
    }
  }

  if (aborted()) {
    const restored = await restore(input)
    return { outcome: 'cancelled', step: 'install', ...restored, reason: 'cancelled before installing' }
  }

  announce('installing')
  const first = await install(input, input.targetCommit)
  // The host *resolves* with `application: 'failed'` rather than throwing, so a
  // settled promise alone is not success. Reading it as one skipped both the
  // build-approval path and the restoration, which is the silent, permanent
  // failure the design warns about.
  if (succeeded(first)) {
    // Success: leave the dependency following the default branch again. If that
    // write fails the update is real but detection is now blind to it, so the
    // outcome says so rather than claiming a clean update.
    const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
    return {
      outcome: 'updated',
      step: 'install',
      result: first.value,
      ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
    }
  }

  // A blocked build script is not a failure to recover from by rolling back: the
  // package is fine, it just needs a decision. Only a repository the user
  // trusted is allowed to answer that decision automatically.
  const approval = input.decideApproval === undefined
    ? { decision: 'none', keys: [] }
    : await input.decideApproval(first)
  if (approval.decision === 'approve' && approval.keys.length > 0 && input.approveBuilds !== undefined) {
    announce('approving')
    // Approving through the host both records the key and performs the install,
    // so its result is the installation attempt rather than a separate retry.
    const approved = await settle(() => input.approveBuilds(approval.keys, pinnedSpec(input.repository, input.targetCommit)))
    if (succeeded(approved)) {
      const unfixed = await restoreSavedSpec({ profileDir: input.profileDir, name: input.name, saved: input.saved })
      return {
        outcome: 'updated',
        step: 'install',
        result: approved.value,
        approved: approval.keys,
        ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
      }
    }
    announce('restoring')
    const restored = await restore(input, approved)
    return { outcome: 'restored', step: 'restore', ...restored, approved: approval.keys }
  }

  if (approval.decision === 'ask') {
    // The plugin is currently absent, so it is restored before the user is asked:
    // a pending question must not leave an installed plugin missing.
    announce('restoring')
    const restored = await restore(input, first)
    return {
      outcome: 'needsApproval', step: 'restore', ...restored,
      needsApproval: approval.keys,
      ...approval.keys.length === 0 ? {} : { reason: `build approval needed for ${approval.keys.join(', ')}` },
    }
  }

  announce('restoring')
  const restored = await restore(input, first)
  return { outcome: 'restored', step: 'restore', ...restored }
}

/**
 * Install one exact commit.
 * @param {{host: object, name: string, repository: string}} input Host and target.
 * @param {string} commit Commit to install.
 * @returns {Promise<{ok: boolean, value?: object, reason?: string}>} The outcome.
 */
async function install(input, commit) {
  return settle(() => input.host.installBundle(pinnedSpec(input.repository, commit), {
    saveExact: true, enabled: true,
  }))
}

/**
 * Reinstall the previously installed commit and return the saved spec to its
 * original value.
 * @param {{
 *   name: string,
 *   repository: string,
 *   saved: string,
 *   previousCommit?: string,
 *   profileDir: string,
 *   host: object
 * }} input Candidate facts and host capabilities.
 * @param {{ok: boolean, value?: object, reason?: string}} [cause] The failure being recovered from.
 * @returns {Promise<{restore?: object, reason?: string}>} The restoration outcome.
 */
async function restore(input, cause) {
  // With no recorded previous commit there is nothing to pin, so the moving
  // spec is the best available attempt to come back to a working state.
  const spec = input.previousCommit === undefined
    ? movingSpec(input.repository)
    : pinnedSpec(input.repository, input.previousCommit)
  const outcome = await settle(() => input.host.installBundle(spec, { saveExact: true, enabled: true }))
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
      ...cause?.reason === undefined ? {} : { reason: cause.reason },
      ...unfixed.ok ? {} : { specRestoreFailed: unfixed.reason },
    }
  }
  return {
    restore: outcome.value,
    reason: `could not restore ${input.name}${caused}; ${recovery}${pinned}`,
  }
}

/**
 * Update a registry-installed plugin through the host's own update path.
 * @param {{
 *   name: string,
 *   version: string,
 *   host: {updateBundle: (name: string, version: string) => Promise<object>},
 *   onPhase?: (phase: string) => void
 * }} input Candidate facts and host capability.
 * @returns {Promise<{outcome: 'updated'|'failed', step: 'install', result?: object, reason?: string}>}
 *   The outcome.
 */
export async function updateRegistry(input) {
  input.onPhase?.('installing')
  const result = await settle(() => input.host.updateBundle(input.name, input.version))
  if (!result.ok) return { outcome: 'failed', step: 'install', reason: result.reason }
  // The host nests this outcome one level deeper on the registry path.
  const application = /** @type {{result?: {application?: string}}} */ (result.value)?.result?.application
  if (application === 'failed' || application === 'cancelled') {
    return { outcome: 'failed', step: 'install', result: result.value, reason: 'the host reported a failed update' }
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
    return { outcome: 'failed', step: 'reload', result: off.value, reason: reasonOf(off) }
  }
  const on = await settle(() => input.host.setBundleEnabled(input.name, true))
  if (!succeeded(on)) {
    return { outcome: 'failed', step: 'reload', result: on.value, reason: reasonOf(on) }
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
