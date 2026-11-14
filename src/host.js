/**
 * The Host service behind the panel.
 *
 * One object owns the whole feature on the Host side: reading the profile,
 * running checks, applying updates, and persisting the two lists. Client and any
 * future caller go through it, so the operations exist once.
 * @module dsh-plugin-updater/host
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { reloadLocal, updateGit, updateRegistry } from './apply.js'
import { decideBuildApproval } from './approve.js'
import { runBatch } from './batch.js'
import { runCheck } from './check.js'
import { CloneCache } from './clone-cache.js'
import { readConfig, mergeConfig } from './config.js'
import { readBundles, readInstalledCommits } from './profile.js'
import { CheckScheduler } from './schedule.js'
import { parseDependency } from './spec.js'
import { addTrusted, isTrusted, parseTrustedRepository } from './trust.js'

/** How a check is asked for. */
const TRIGGERS = new Set(['startup', 'interval', 'manual'])

/**
 * The updater service.
 */
export class UpdaterService {
  /**
   * @param {{
   *   profileDir: string,
   *   cacheDir?: string,
   *   pluginManager: object,
   *   config: () => object,
   *   writeConfig: (patch: object) => Promise<void>,
   *   emit: (event: string, payload: object) => void,
   *   log?: {warn: (...args: unknown[]) => void}
   * }} options Host wiring.
   */
  constructor(options) {
    this.profileDir = options.profileDir
    this.pluginManager = options.pluginManager
    this.configOf = options.config
    this.writeConfig = options.writeConfig
    this.emit = options.emit
    this.log = options.log ?? { warn: () => {} }
    this.cache = new CloneCache({ directory: options.cacheDir ?? join(homedir(), '.dsh', 'plugin-updater', 'clones') })
    this.hostStart = Date.now()
    this.lastCheck = undefined
    this.restartRequired = []
    // A saved spec that could not be reset leaves detection comparing a commit
    // with itself, so the warning must survive the reload that follows an
    // update. Keyed by candidate name; cleared when a later update of the same
    // candidate resets the spec successfully.
    this.specRestoreFailures = new Map()
    this.cancellation = undefined
    this.checkFailure = undefined
    // One queue or single update at a time, exposed to the panel while it runs:
    // the client cannot see the host's own progress events, so the records here
    // are what the snapshot polls.
    this.run = undefined
    this.runSequence = 0
    // A re-check must not overlap a detection started elsewhere; this holds the
    // in-flight re-check so a detection can wait for it.
    this.rechecking = undefined
    // A build approval the user still has to decide. The keys and the target
    // stay on the host; the client only names the candidate and the decision.
    this.pendingApprovals = new Map()
    // The installation inventory is read once per host start: it cannot change
    // while the process runs.
    this.shipped = undefined
    this.scheduler = new CheckScheduler({
      check: () => this.check(),
      onStateChange: (state) => {
        // A cycle that threw keeps the last result but must not present it as
        // current; the snapshot reads this to mark the entry.
        this.checkFailure = state.running === true || state.current !== false
          ? undefined
          : (state.failure ?? 'the check failed')
        this.emit('plugin-updater/check-state', state)
      },
    })
  }

  /**
   * Read the configuration into its normalised form.
   * @returns {object} Trusted repositories and ignored updates.
   */
  config() {
    return readConfig(this.configOf())
  }

  /**
   * The packages the Harness installation itself supplies.
   *
   * A bundle that ships with the application is not the profile's to replace, so
   * it is never offered as a candidate. The Host reports this as
   * `BundleInfo.availability === 'installation'`. Reading the inventory is
   * best-effort: a Host without `listBundles` simply supplies no exclusion.
   * @returns {Promise<(name: string) => boolean>} A predicate over bundle names.
   */
  async installedByHarness() {
    if (this.shipped !== undefined) return this.shipped
    const names = new Set()
    try {
      const listed = await this.pluginManager.listBundles?.()
      for (const bundle of Array.isArray(listed) ? listed : []) {
        if (bundle?.availability === 'installation' && typeof bundle.name === 'string') names.add(bundle.name)
      }
    } catch (error) {
      // A failure is NOT cached. The inventory is stable once read, but a read can
      // fail transiently — at startup, under a file lock, across an HMR restart —
      // and caching that would leave a bundle the Harness ships updatable for the
      // rest of the process. Retrying next cycle costs one call.
      this.log.warn?.('Plugin Updater: could not read the installation inventory', error)
      return providesNothing
    }
    this.shipped = (name) => names.has(name)
    return this.shipped
  }

  /**
   * Run one check.
   * @returns {Promise<object>} The check outcome.
   */
  async check() {
    // The interval scheduler does not go through refresh(), so it needs the
    // same wait as a manual check.
    if (this.rechecking !== undefined) await this.rechecking.catch(() => {})
    const shipped = await this.installedByHarness()
    const bundles = await readBundles(this.profileDir, parseDependency, { installationProvides: shipped })
    const commits = await readInstalledCommits(this.profileDir)
    // Record the installed commit on each candidate: it is what a failed update
    // restores to, and the lockfile is the only place it appears.
    attachInstalledCommits(bundles, commits)
    const { ignoredUpdates } = this.config()
    const result = await runCheck({
      candidates: bundles,
      commits,
      cache: this.cache,
      ignored: ignoredUpdates,
      listVersions: (name) => this.pluginManager.listVersions(name),
    })
    const reloads = await this.findReloads(bundles)
    this.lastCheck = {
      ...result,
      candidates: bundles,
      reloads,
      total: result.updates.length + reloads.length + result.unchecked.length,
    }
    this.pruneApprovals()
    return this.lastCheck
  }

  /**
   * Local plugins whose files are newer than this Host's start.
   * @param {readonly {name: string, parsed: object}[]} bundles Installed bundles.
   * @returns {Promise<object[]>} Candidates needing a reload.
   */
  async findReloads(bundles) {
    const { newestModification } = await import('./profile.js')
    const reloads = []
    for (const bundle of bundles) {
      const parsed = /** @type {{kind: string, path?: string}} */ (bundle.parsed)
      if (parsed.kind !== 'local' || parsed.path === undefined) continue
      const newest = await newestModification(parsed.path, ['package.json', 'index.js', 'client.js', 'cordis.patch.yml'])
      if (newest === undefined || newest <= this.hostStart) continue
      reloads.push({ name: bundle.name, kind: 'local', state: 'update', installed: bundle.version, path: parsed.path })
    }
    return reloads
  }

  /**
   * The most recent check, asking for one when none has run.
   * @returns {Promise<object>} The check outcome.
   */
  async snapshot() {
    if (this.lastCheck === undefined) {
      // A first check can fail — a new profile has no manifest to read. The
      // scheduler already recorded that as `checkFailure`; letting the rejection
      // escape would show a generic error instead of the "state is unknown"
      // answer the spec asks for on a first run.
      await this.scheduler.run('startup').catch(() => {})
    }
    const current = this.lastCheck ?? { updates: [], reloads: [], unchecked: [], ignored: [], total: 0 }
    const usage = await this.cache.usage()
    return {
      ...current,
      restartRequired: this.currentRestartRequired(),
      specRestoreFailed: this.currentSpecRestoreFailures(),
      cache: usage,
      running: this.scheduler.isRunning(),
      run: this.currentRun(),
      approvals: this.currentApprovals(),
      // A cycle that threw leaves the previous counts in place; reporting them as
      // current would read as "all good" on a failure.
      current: this.checkFailure === undefined,
      ...this.checkFailure === undefined ? {} : { lastFailure: this.checkFailure },
      ...this.config(),
    }
  }

  /**
   * Run a check on demand.
   * @returns {Promise<object>} The check outcome.
   */
  async refresh() {
    // A re-check updates the same result set; starting a detection while it
    // reads the profile would let the two merge from different starts.
    if (this.rechecking !== undefined) await this.rechecking.catch(() => {})
    await this.scheduler.run('manual')
    return this.snapshot()
  }

  /**
   * Refresh after an update without letting a failed check discard the result.
   *
   * The update already applied; if the following check cannot read the profile
   * or the network, the settled outcome is still the answer, and the next check
   * reports the state.
   * @returns {Promise<void>}
   */
  async refreshQuietly() {
    try {
      await this.refresh()
    } catch (error) {
      this.log.warn?.('Plugin Updater: the check after an update failed', error)
    }
  }

  /**
   * Check one failed candidate without running detection for the others.
   *
   * The full check waits for a running cycle first: starting a second detection
   * is what the scheduler refuses, and a retry that silently did nothing would
   * read as a dead control.
   * @param {{name?: string}} [request] Candidate name.
   * @returns {Promise<object>} The snapshot after the candidate's result was merged.
   */
  async recheck(request = {}) {
    const name = typeof request.name === 'string' ? request.name : ''
    if (name === '') throw new Error('recheck needs the name of an installed plugin')
    if (this.rechecking !== undefined) await this.rechecking.catch(() => {})
    const work = this.performRecheck(name)
    this.rechecking = work
    try {
      return await work
    } finally {
      if (this.rechecking === work) this.rechecking = undefined
    }
  }

  /**
   * Check one named candidate and merge its result into the last check.
   * @param {string} name Candidate name.
   * @returns {Promise<object>} The snapshot afterwards.
   */
  async performRecheck(name) {
    await this.scheduler.whenIdle()
    const shipped = await this.installedByHarness()
    const bundles = await readBundles(this.profileDir, parseDependency, { installationProvides: shipped })
    const commits = await readInstalledCommits(this.profileDir)
    // Every candidate keeps its installed commit: a later failed update of a
    // neighbour must restore the commit it was installed at, not the moving
    // spec.
    attachInstalledCommits(bundles, commits)
    const candidate = bundles.find((entry) => entry.name === name)
    if (candidate === undefined) throw new Error(`${name} is not an installed plugin candidate`)
    const { ignoredUpdates } = this.config()
    const result = await runCheck({
      candidates: [candidate],
      commits,
      cache: this.cache,
      ignored: ignoredUpdates,
      listVersions: (bundleName) => this.pluginManager.listVersions(bundleName),
    })
    if (this.lastCheck === undefined) {
      this.lastCheck = {
        ...result,
        candidates: bundles,
        reloads: [],
        total: result.updates.length + result.unchecked.length,
      }
    } else {
      const updates = this.lastCheck.updates.filter((entry) => entry.name !== name)
      const ignored = this.lastCheck.ignored.filter((entry) => entry.name !== name)
      const unchecked = this.lastCheck.unchecked.filter((entry) => entry.name !== name)
      updates.push(...result.updates)
      ignored.push(...result.ignored)
      unchecked.push(...result.unchecked)
      this.lastCheck = {
        ...this.lastCheck,
        candidates: bundles,
        updates,
        ignored,
        unchecked,
        total: updates.length + this.lastCheck.reloads.length + unchecked.length,
      }
    }
    this.pruneApprovals()
    return this.snapshot()
  }

  /**
   * Update one candidate.
   *
   * The gateway passes named wire arguments as one object per declared
   * parameter, and the `updateOne` descriptor declares a single `request`, so
   * this method takes that object rather than a bare name.
   * @param {{name?: string, signal?: AbortSignal}} [request] Candidate name and cancellation.
   * @returns {Promise<object>} The outcome for that candidate.
   */
  async updateOne(request = {}) {
    const name = typeof request.name === 'string' ? request.name : ''
    if (name === '') throw new Error('updateOne needs the name of an installed plugin')
    const state = this.candidateState(name)
    const item = { name, kind: state.kind }
    // A single update is cancellable too, so it needs the same owned controller
    // the queue has.
    const own = new AbortController()
    this.cancellation = own
    const signal = request.signal === undefined ? own.signal : AbortSignal.any([request.signal, own.signal])
    const requestId = this.newRequestId(name)
    this.beginRun()
    this.setRunCurrent(name, this.initialStep(state.kind), requestId)
    try {
      const result = await this.runItem(item, state, { signal, requestId })
      this.noteRunResult(name, result)
      if (result?.outcome === 'updated' || result?.outcome === 'reloaded') await this.refreshQuietly()
      return result
    } finally {
      this.finishRun()
      if (this.cancellation === own) this.cancellation = undefined
    }
  }

  /**
   * Update every pending candidate in one queue.
   * @param {{signal?: AbortSignal}} [request] Cancellation.
   * @returns {Promise<{results: object[], cancelled: boolean, skippedIgnored?: number}>} One result per candidate attempted.
   */
  async updateAll(request = {}) {
    if (this.lastCheck === undefined) await this.scheduler.run('startup')
    const pending = [
      ...(this.lastCheck?.updates ?? []),
      ...(this.lastCheck?.reloads ?? []),
    ]
    const items = pending.map((entry) => ({ name: entry.name, kind: entry.kind }))
    // Ignored updates are deliberately not queued; the count travels so the
    // summary can say how many were left alone rather than silently omitting them.
    const skippedIgnored = (this.lastCheck?.ignored ?? []).length
    // One controller per queue, so `cancel` has something to abort. The caller's
    // own signal still cancels independently.
    const own = new AbortController()
    this.cancellation = own
    const signal = request.signal === undefined
      ? own.signal
      : AbortSignal.any([request.signal, own.signal])
    this.beginRun()
    try {
      const outcome = await runBatch({
        items,
        signal,
        // A precondition failure is one candidate's outcome, not the queue's.
        // `runItem` throws for a missing repository, a missing target commit, a
        // missing target version, and `updateGit` can throw while restoring the
        // saved spec. Left uncontained, any of those abandons every candidate
        // still queued and discards the results already produced, which is the
        // opposite of the "remaining candidates are still attempted" rule.
        run: async (item) => {
          const requestId = this.newRequestId(item.name)
          this.setRunCurrent(item.name, this.initialStep(item.kind), requestId)
          try {
            return await this.runItem(item, this.candidateState(item.name), { signal, requestId })
          } catch (error) {
            return {
              outcome: 'failed',
              step: 'prepare',
              reason: error instanceof Error ? error.message : String(error),
            }
          }
        },
        onResult: (name, result) => {
          this.noteRunResult(name, result)
          this.emit('plugin-updater/row-state', { name, result })
        },
      })
      if (outcome.results.some((entry) => entry.outcome === 'updated' || entry.outcome === 'reloaded')) {
        await this.refreshQuietly()
      }
      return { ...outcome, skippedIgnored }
    } finally {
      this.finishRun()
      if (this.cancellation === own) this.cancellation = undefined
    }
  }

  /**
   * The pending state of one candidate.
   * @param {string} name Candidate name.
   * @returns {object} The state, or a synthetic entry for an unknown name.
   */
  candidateState(name) {
    const all = [...(this.lastCheck?.updates ?? []), ...(this.lastCheck?.reloads ?? [])]
    const found = all.find((entry) => entry.name === name)
    if (found !== undefined) return found
    const bundle = this.lastCheck?.candidates?.find((entry) => entry.name === name)
    if (bundle === undefined) throw new Error(`${name} is not an installed plugin candidate`)
    const kind = /** @type {{kind: string}} */ (bundle.parsed).kind
    return { name, kind: kind === 'git' ? 'git' : kind === 'local' ? 'local' : 'registry', state: 'update', installed: bundle.version }
  }

  /**
   * Run one candidate's update.
   * @param {{name: string, kind: string}} item The queue item.
   * @param {object} state Its checked state.
   * @param {{signal?: AbortSignal, requestId?: string, approvedBuilds?: string[]}} options
   *   Cancellation, the plugin manager request the steps are reported under, and
   *   approval keys already decided on the host.
   * @returns {Promise<object>} The outcome.
   */
  async runItem(item, state, options) {
    const announce = (phase) => {
      this.noteRunStep(item.name, phase)
      this.emit('plugin-updater/row-phase', { name: item.name, phase })
    }
    const bundle = this.lastCheck?.candidates?.find((entry) => entry.name === item.name)
    let result
    if (item.kind === 'local') {
      result = await reloadLocal({ name: item.name, host: this.pluginManager, onPhase: announce })
    } else if (item.kind === 'git') {
      const parsed = /** @type {{repository?: string}} */ (bundle?.parsed ?? {})
      if (parsed.repository === undefined) throw new Error(`${item.name} has no repository to install from`)
      const identity = /** @type {{commit?: string}} */ (state.identity ?? {})
      if (identity.commit === undefined) throw new Error(`${item.name} has no target commit`)
      result = await updateGit({
        name: item.name,
        repository: parsed.repository,
        saved: bundle?.saved ?? `github:${parsed.repository.split('/').slice(1).join('/')}`,
        previousCommit: this.installedCommitOf(item.name),
        targetCommit: identity.commit,
        profileDir: this.profileDir,
        host: this.pluginManager,
        signal: options.signal,
        requestId: options.requestId,
        onPhase: announce,
        // Approval is decided against the repositories the user trusted, from
        // the keys the failed run itself reported. A decision already made on
        // the host replays those keys instead of asking again.
        decideApproval: options.approvedBuilds === undefined
          ? async (failure) => decideBuildApproval({
            pendingBuilds: /** @type {{pendingBuilds?: string[]}} */ (failure.value ?? {}).pendingBuilds,
            output: /** @type {{result?: {packageResult?: {output?: string}}}} */ (failure.value ?? {}).result?.packageResult?.output,
            repository: parsed.repository,
            trustedRepositories: this.config().trustedRepositories,
          })
          : async () => ({ decision: 'approve', keys: options.approvedBuilds }),
        approveBuilds: (keys, spec) => this.pluginManager.installBundle(spec, {
          approvedBuilds: keys,
          saveExact: true,
          enabled: true,
          ...options.requestId === undefined ? {} : { requestId: options.requestId },
        }),
      })
    } else {
      const identity = /** @type {{available?: string}} */ (state.identity ?? {})
      if (identity.available === undefined) throw new Error(`${item.name} has no target version`)
      result = await updateRegistry({
        name: item.name,
        version: identity.available,
        host: this.pluginManager,
        requestId: options.requestId,
        onPhase: announce,
      })
    }
    this.noteSpecRestore(item.name, result)
    this.noteRestart(item.name, result)
    this.noteApproval(item, state, result)
    // The package manager's output is what the user needs when a step fails, so
    // it travels with the result rather than only into the event stream.
    const packageResult = /** @type {{result?: {packageResult?: object}, restore?: {packageResult?: object}}} */ (result)
    const output = packageResult.result?.packageResult ?? packageResult.restore?.packageResult
    return output === undefined ? result : { ...result, output: trimOutput(output) }
  }

  /**
   * The commit a candidate is installed at, when known.
   * @param {string} name Candidate name.
   * @returns {string|undefined} The commit.
   */
  installedCommitOf(name) {
    const state = this.lastCheck?.candidates?.find((entry) => entry.name === name)
    return /** @type {{installedCommit?: string}} */ (state ?? {}).installedCommit
  }

  /**
   * A request id the plugin manager carries into its progress and log events.
   * @param {string} name Candidate name.
   * @returns {string} A fresh id for one attempt.
   */
  newRequestId(name) {
    this.runSequence += 1
    return `updater:${name}:${this.runSequence}`
  }

  /**
   * Start recording one queue or single attempt.
   * @returns {void}
   */
  beginRun() {
    this.run = { startedAt: Date.now(), current: undefined, results: [] }
  }

  /** @returns {void} Stop exposing the run record once the call settles. */
  finishRun() {
    this.run = undefined
  }

  /**
   * Name the candidate whose attempt is currently executing.
   * @param {string} name Candidate name.
   * @param {string} step Initial step.
   * @param {string} requestId The plugin manager request.
   * @returns {void}
   */
  setRunCurrent(name, step, requestId) {
    if (this.run === undefined) return
    this.run.current = { name, step, requestId }
  }

  /**
   * Advance the current step when the running candidate reports one.
   * @param {string} name Candidate name.
   * @param {string} step New step.
   * @returns {void}
   */
  noteRunStep(name, step) {
    if (this.run?.current?.name !== name) return
    this.run.current.step = step
  }

  /**
   * Record one settled candidate without waiting for the queue to finish.
   * @param {string} name Candidate name.
   * @param {object} result Outcome.
   * @returns {void}
   */
  noteRunResult(name, result) {
    if (this.run === undefined) return
    this.run.results.push({
      name,
      outcome: typeof result?.outcome === 'string' ? result.outcome : 'failed',
      ...typeof result?.reason === 'string' ? { reason: result.reason } : {},
    })
  }

  /**
   * The step a candidate starts on, by source.
   * @param {unknown} kind Candidate kind.
   * @returns {string} The step name.
   */
  initialStep(kind) {
    if (kind === 'local') return 'reloading'
    if (kind === 'git') return 'removing'
    return 'checking'
  }


  /**
   * The plugins whose update still needs a restart, restricted to installed ones.
   *
   * A plugin the user removed needs no restart, and listing it would ask for one
   * that changes nothing.
   * @returns {string[]} Candidate names awaiting a restart.
   */
  currentRestartRequired() {
    const installed = new Set((this.lastCheck?.candidates ?? []).map((entry) => entry.name))
    return this.restartRequired.filter((name) => installed.has(name))
  }

  /**
   * The pinned-spec warnings that still describe an installed plugin.
   *
   * A warning for a plugin the user has since removed would point at nothing, so
   * it is dropped rather than carried in every snapshot.
   * @returns {{name: string, reason: string}[]} One entry per affected candidate.
   */
  currentSpecRestoreFailures() {
    const installed = new Set((this.lastCheck?.candidates ?? []).map((entry) => entry.name))
    // Forget entries for plugins that are gone rather than only hiding them: a
    // filter bounds what the client sees but not what the process holds, and
    // nothing else ever removes an entry for a candidate the user uninstalled.
    for (const name of [...this.specRestoreFailures.keys()]) {
      if (!installed.has(name)) this.specRestoreFailures.delete(name)
    }
    return [...this.specRestoreFailures].map(([name, reason]) => ({ name, reason }))
  }

  /**
   * Record whether a candidate's saved spec was reset successfully.
   *
   * A spec left pinned to the commit just installed makes later detection
   * compare that commit with itself, so the update is reported as "current"
   * forever and the user never learns why. The failure is therefore kept until a
   * later update of the same candidate resets its spec, and it travels in the
   * snapshot so the panel still shows it after the reload that follows an
   * update.
   * @param {string} name Candidate name.
   * @param {object} result Outcome, possibly carrying `specRestoreFailed`.
   * @returns {void}
   */
  noteSpecRestore(name, result) {
    const reason = /** @type {{specRestoreFailed?: unknown}} */ (result).specRestoreFailed
    if (typeof reason === 'string' && reason !== '') {
      this.specRestoreFailures.set(name, reason)
      this.emit('plugin-updater/spec-restore-failed', { name, reason })
      return
    }
    this.specRestoreFailures.delete(name)
  }

  /**
   * Record a restart requirement reported by the host.
   *
   * The registry path nests the change under `result`, the git path returns it
   * directly, so both shapes are read. This is the only producer of the notice,
   * so missing one shape means the user is never told a restart is needed.
   * @param {string} name Candidate name.
   * @param {object} result Outcome carrying an application somewhere.
   * @returns {void}
   */
  noteRestart(name, result) {
    const nested = /** @type {{result?: {result?: {application?: string}, application?: string}, application?: string, restore?: {application?: string}}} */ (result)
    // A registry result nests the plugin manager's change under result.result.
    const application = nested.result?.result?.application
      ?? nested.result?.application
      ?? nested.application
    if (application !== 'restart-required') return
    if (this.restartRequired.includes(name)) return
    this.restartRequired.push(name)
    this.emit('plugin-updater/restart-required', { name })
  }

  /**
   * Keep or drop the approval request a settled attempt produced.
   *
   * The keys and the target commit stay here, never in the client: approving
   * later replays exactly what the package manager reported for this attempt.
   * @param {{name: string, kind: string}} item The attempted candidate.
   * @param {object} state Its checked state.
   * @param {object} result The settled outcome.
   * @returns {void}
   */
  noteApproval(item, state, result) {
    if (item.kind !== 'git' || result?.outcome !== 'needsApproval') {
      this.pendingApprovals.delete(item.name)
      return
    }
    const bundle = this.lastCheck?.candidates?.find((entry) => entry.name === item.name)
    const parsed = /** @type {{repository?: string}} */ (bundle?.parsed ?? {})
    const identity = /** @type {{commit?: string}} */ (state?.identity ?? {})
    const keys = Array.isArray(result.needsApproval)
      ? result.needsApproval.filter((key) => typeof key === 'string' && key !== '')
      : []
    if (typeof parsed.repository !== 'string' || typeof identity.commit !== 'string' || keys.length === 0) {
      this.pendingApprovals.delete(item.name)
      return
    }
    this.pendingApprovals.set(item.name, {
      name: item.name,
      repository: parsed.repository,
      targetCommit: identity.commit,
      keys,
    })
  }

  /**
   * A detached copy of the run record.
   *
   * The snapshot is read repeatedly while a run executes; handing out the live
   * record would let a consumer hold a reference that keeps changing after it
   * read it, and would expose host state to mutation.
   * @returns {object|undefined} The run, or undefined when none is active.
   */
  currentRun() {
    if (this.run === undefined) return undefined
    return {
      startedAt: this.run.startedAt,
      ...this.run.current === undefined ? {} : { current: { ...this.run.current } },
      results: this.run.results.map((entry) => ({ ...entry })),
    }
  }

  /**
   * The pending approvals that still describe an installed plugin.
   * @returns {{name: string, repository: string, keys: string[], targetCommit: string}[]}
   *   One entry per undecided candidate.
   */
  currentApprovals() {
    const installed = new Set((this.lastCheck?.candidates ?? []).map((entry) => entry.name))
    return [...this.pendingApprovals.values()]
      .filter((pending) => installed.has(pending.name))
      .map((pending) => ({
        name: pending.name,
        repository: pending.repository,
        keys: pending.keys,
        targetCommit: pending.targetCommit,
      }))
  }

  /**
   * Drop approvals for plugins that are no longer installed.
   *
   * The request stays decidable after HEAD moves: the retained target is the
   * commit the user was asked about, and installing it is still a valid
   * decision. Only losing the plugin makes the request meaningless.
   * @returns {void}
   */
  pruneApprovals() {
    const candidates = new Set((this.lastCheck?.candidates ?? []).map((entry) => entry.name))
    for (const name of [...this.pendingApprovals.keys()]) {
      if (!candidates.has(name)) this.pendingApprovals.delete(name)
    }
  }


  /**
   * The commits the lockfile resolved, so a subsequent update knows what to
   * restore to.
   * @returns {Promise<void>}
   */
  async primeCommits() {
    const commits = await readInstalledCommits(this.profileDir)
    for (const [name, commit] of commits) {
      const bundle = this.lastCheck?.candidates?.find((entry) => entry.name === name)
      if (bundle !== undefined) /** @type {Record<string, unknown>} */ (bundle).installedCommit = commit
    }
  }

  /**
   * Replace the two persisted lists.
   *
   * Takes the gateway's single `request` object, which carries a partial write.
   * @param {{trustedRepositories?: unknown, ignoredUpdates?: unknown}} [request] Replacement values.
   * @returns {Promise<object>} The full snapshot afterwards, so a caller that
   *   replaces its state does not lose the pending list.
   */
  async saveConfig(request = {}) {
    const next = mergeConfig(this.configOf(), request)
    await this.writeConfig(next)
    this.emit('plugin-updater/config-changed', next)
    return this.snapshot()
  }

  /**
   * Trust the repository a candidate was installed from.
   *
   * The repository is read from the saved dependency spec on the host; a name
   * from the client never becomes a trust entry. Only a git candidate can be
   * trusted, and only for the exact host and path it names.
   * @param {{name?: string}} [request] Candidate name.
   * @returns {Promise<object>} The snapshot afterwards.
   */
  async trustRepository(request = {}) {
    const name = typeof request.name === 'string' ? request.name : ''
    if (name === '') throw new Error('trustRepository needs the name of an installed plugin')
    const candidate = this.lastCheck?.candidates?.find((entry) => entry.name === name)
    if (candidate === undefined) throw new Error(`${name} is not an installed plugin candidate`)
    const parsed = /** @type {{kind?: string, repository?: string}} */ (candidate.parsed ?? {})
    if (parsed.kind !== 'git' || typeof parsed.repository !== 'string') {
      throw new Error(`${name} is not installed from a git repository`)
    }
    const identity = parseTrustedRepository(parsed.repository)
    if (!identity.ok) throw new Error(`the repository of ${name} could not be read: ${identity.reason}`)
    const config = this.config()
    if (isTrusted(identity.repository, config.trustedRepositories)) return this.snapshot()
    const next = mergeConfig(this.configOf(), {
      trustedRepositories: addTrusted(config.trustedRepositories, identity.repository),
    })
    await this.writeConfig(next)
    this.emit('plugin-updater/config-changed', next)
    return this.snapshot()
  }

  /**
   * Decide a pending build-script approval.
   *
   * Allow replays the retained keys and target commit; always-allow trusts the
   * repository first; decline withdraws the request. The client supplies only
   * the candidate and the decision, never the keys.
   * @param {{name?: string, decision?: string}} [request] Candidate and decision.
   * @returns {Promise<{snapshot: object, result?: object}>} The snapshot and, for
   *   an applied decision, the outcome of the installation.
   */
  async decideBuild(request = {}) {
    const name = typeof request.name === 'string' ? request.name : ''
    const decision = request.decision
    if (name === '') throw new Error('decideBuild needs the name of an installed plugin')
    if (decision !== 'allow' && decision !== 'always-allow' && decision !== 'decline') {
      throw new Error('decideBuild needs a decision of allow, always-allow, or decline')
    }
    const pending = this.pendingApprovals.get(name)
    if (pending === undefined) throw new Error(`${name} has no pending build approval`)
    if (decision === 'decline') {
      this.pendingApprovals.delete(name)
      return { snapshot: await this.snapshot() }
    }
    if (decision === 'always-allow') {
      const config = this.config()
      if (!isTrusted(pending.repository, config.trustedRepositories)) {
        const next = mergeConfig(this.configOf(), {
          trustedRepositories: addTrusted(config.trustedRepositories, pending.repository),
        })
        await this.writeConfig(next)
        this.emit('plugin-updater/config-changed', next)
      }
    }
    const state = this.candidateState(name)
    const target = {
      ...state,
      identity: { .../** @type {{identity?: object}} */ (state).identity, commit: pending.targetCommit },
    }
    const own = new AbortController()
    this.cancellation = own
    const requestId = this.newRequestId(name)
    this.beginRun()
    this.setRunCurrent(name, 'installing', requestId)
    try {
      const result = await this.runItem({ name, kind: 'git' }, target, {
        signal: own.signal,
        requestId,
        approvedBuilds: pending.keys,
      })
      this.noteRunResult(name, result)
      if (result?.outcome === 'updated' || result?.outcome === 'reloaded') await this.refreshQuietly()
      if (result?.outcome !== 'needsApproval') this.pendingApprovals.delete(name)
      return { snapshot: await this.snapshot(), result }
    } finally {
      this.finishRun()
      if (this.cancellation === own) this.cancellation = undefined
    }
  }

  /**
   * Attach the binding the gateway requires on a Remote service.
   *
   * The gateway refuses to dispatch a method when the receiver exposes no
   * `typertRemote` whose `service` is the receiver itself and whose `serviceKey`
   * and `namespace` match the descriptor's service. `TypertRemoteService` sets
   * this in its constructor; this service is a plain class because the host
   * entry is a function plugin, so it is attached explicitly.
   * @param {string} serviceKey The Cordis service key and wire namespace.
   * @returns {void}
   */
  bindRemote(serviceKey) {
    Object.defineProperty(this, 'typertRemote', {
      value: Object.freeze({ service: this, serviceKey, namespace: serviceKey }),
      enumerable: false,
      configurable: false,
      writable: false,
    })
  }

  /**
   * Abandon a running queue.
   *
   * Cancellation has to be owned here rather than delegated: the host's own
   * cancel reports `too-late` once it is applying, and the removal step accepts
   * no signal at all, so the queue itself is what decides not to start the next
   * candidate.
   * @returns {{cancelled: boolean}} Whether a queue was running.
   */
  cancel() {
    if (this.cancellation === undefined) return { cancelled: false }
    this.cancellation.abort()
    return { cancelled: true }
  }

  /**
   * Clear the clone cache.
   * @returns {Promise<object>} The full snapshot afterwards, so a caller that
   *   replaces its state does not lose the pending list.
   */
  async clearCache() {
    await this.cache.clear()
    return this.snapshot()
  }

  /**
   * Start the periodic check and run the first one.
   * @returns {void}
   */
  start() {
    this.scheduler.start()
    void this.primeCommits()
      .then(() => this.scheduler.run('startup'))
      .catch((error) => { this.log.warn('Plugin Updater: first check failed', error) })
  }

  /**
   * Stop the periodic check.
   * @returns {void}
   */
  stop() {
    this.scheduler.stop()
  }
}

/**
 * The harness home directory.
 *
 * A user can relocate it with `DSH_HOME`, and the host exposes the resolved path
 * as `dshHomePath`. Reading `~/.dsh` directly would write outside their harness
 * and is the one path that would bypass the profile this entry was handed.
 * @param {object} ctx Host context.
 * @returns {string} Absolute path to the harness home.
 */
function resolveHome(ctx) {
  const resolved = ctx.dshHomePath?.()
  if (typeof resolved === 'string' && resolved !== '') return resolved
  return join(homedir(), '.dsh')
}

/** A predicate that excludes nothing, for a Host without a readable inventory. */
const providesNothing = () => false

/**
 * Whether a value is a known check trigger.
 * @param {unknown} value Candidate trigger.
 * @returns {boolean} True when it is one.
 */
export function isTrigger(value) {
  return typeof value === 'string' && TRIGGERS.has(value)
}

/**
 * Record the lockfile commit on every candidate.
 *
 * The lockfile is the only place an installed git commit appears, and an update
 * restores to it. Missing one candidate silently downgrades its restore path to
 * the moving spec.
 * @param {object[]} bundles Installed bundles.
 * @param {Map<string, string>} commits Package name to installed commit.
 * @returns {void}
 */
function attachInstalledCommits(bundles, commits) {
  for (const bundle of bundles) {
    const commit = commits.get(bundle.name)
    if (commit !== undefined) /** @type {Record<string, unknown>} */ (bundle).installedCommit = commit
  }
}

/** Longest package manager excerpt a row carries, in characters. */
const OUTPUT_LIMIT = 8000

/**
 * Keep the tail of a package manager run, which is where the failure is.
 * @param {unknown} packageResult The run result.
 * @returns {{text: string, truncated: boolean}} The excerpt and whether it was cut.
 */
function trimOutput(packageResult) {
  const output = typeof packageResult === 'object' && packageResult !== null
    ? /** @type {{output?: unknown, exitCode?: unknown}} */ (packageResult)
    : {}
  const text = typeof output.output === 'string' ? output.output : ''
  const exitCode = typeof output.exitCode === 'number' ? output.exitCode : undefined
  const tail = text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text
  return {
    text: tail,
    truncated: text.length > OUTPUT_LIMIT,
    ...exitCode === undefined ? {} : { exitCode },
  }
}

/**
 * Mount the plugin.
 * @param {object} ctx Host context.
 * @param {object} rawConfig Row configuration.
 * @returns {void}
 */
export function apply(ctx, rawConfig, bindOptions = { serviceKey: 'pluginUpdater' }) {
  const profileDir = ctx.profileContext?.dir ?? ctx.profileContext?.profileDir
  if (typeof profileDir !== 'string' || profileDir === '') {
    ctx.logger?.warn?.('Plugin Updater needs a profile directory; the entry stays inactive.')
    return
  }
  // The row's own configuration, read fresh on every access: the config editor
  // restarts the plugin after an edit, so a captured object would go stale.
  let rowConfig = rawConfig
  const service = new UpdaterService({
    profileDir,
    cacheDir: join(resolveHome(ctx), 'plugin-updater', 'clones'),
    pluginManager: ctx.pluginManager,
    config: () => rowConfig,
    writeConfig: async (next) => {
      // Written through the host's config editor so the profile patch file stays
      // the user's file: the plugin never reads or rewrites it itself.
      const entry = ctx.fiber?.entry
      const editor = ctx.get?.('configEditor')
      if (entry === undefined || editor === undefined) {
        throw new Error('configuration cannot be saved in this profile')
      }
      await editor.edit(entry, (current) => ({ ...current, ...next }))
      rowConfig = { ...rowConfig, ...next }
    },
    emit: (event, payload) => { ctx.emit(event, payload) },
    log: ctx.logger,
  })
  // Exposed as a Cordis service so the remote descriptors, whose `service` field
  // names this key, resolve to a live object rather than to nothing.
  ctx.provide?.('pluginUpdater', service)
  // The binding the gateway validates before it dispatches any endpoint.
  service.bindRemote(bindOptions.serviceKey)
  // Registering the descriptor set is what claims the endpoints at the gateway;
  // a Cordis service alone leaves every call unanswered.
  if (bindOptions.hostFace !== undefined) {
    ctx.effect(() => ctx.typert.register(bindOptions.hostFace), 'plugin-updater: typert')
  }
  ctx.effect(() => {
    service.start()
    return () => { service.stop() }
  }, 'plugin-updater: schedule')
}
