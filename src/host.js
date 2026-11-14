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
    const shipped = await this.installedByHarness()
    const bundles = await readBundles(this.profileDir, parseDependency, { installationProvides: shipped })
    const commits = await readInstalledCommits(this.profileDir)
    // Record the installed commit on each candidate: it is what a failed update
    // restores to, and the lockfile is the only place it appears.
    for (const bundle of bundles) {
      const commit = commits.get(bundle.name)
      if (commit !== undefined) /** @type {Record<string, unknown>} */ (bundle).installedCommit = commit
    }
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
      proposedRepositories: this.proposeRepositories(current),
      // A cycle that threw leaves the previous counts in place; reporting them as
      // current would read as "all good" on a failure.
      current: this.checkFailure === undefined,
      ...this.checkFailure === undefined ? {} : { lastFailure: this.checkFailure },
      ...this.config(),
    }
  }

  /**
   * The repositories to propose for trust before the user has decided.
   *
   * Trust is offered only once, and only for the repositories of plugins the
   * user already chose to install. An explicit empty list counts as a decision,
   * so declining the proposal does not make it reappear on every open.
   * @param {object} state The current check result.
   * @returns {string[]} Repositories awaiting confirmation, or an empty list.
   */
  proposeRepositories(state) {
    const raw = this.configOf()
    if (typeof raw === 'object' && raw !== null && Object.hasOwn(raw, 'trustedRepositories')) return []
    const repositories = []
    for (const candidate of state.candidates ?? []) {
      const parsed = /** @type {{kind?: string, repository?: string}} */ (candidate.parsed ?? {})
      if (parsed.kind === 'git' && parsed.repository !== undefined && !repositories.includes(parsed.repository)) {
        repositories.push(parsed.repository)
      }
    }
    return repositories
  }

  /**
   * Run a check on demand.
   * @returns {Promise<object>} The check outcome.
   */
  async refresh() {
    await this.scheduler.run('manual')
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
    try {
      return await this.runItem(item, state, { signal })
    } finally {
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
          try {
            return await this.runItem(item, this.candidateState(item.name), { signal })
          } catch (error) {
            return {
              outcome: 'failed',
              step: 'prepare',
              reason: error instanceof Error ? error.message : String(error),
            }
          }
        },
        onResult: (name, result) => { this.emit('plugin-updater/row-state', { name, result }) },
      })
      if (outcome.results.some((entry) => entry.outcome === 'updated' || entry.outcome === 'reloaded')) {
        await this.refresh()
      }
      return { ...outcome, skippedIgnored }
    } finally {
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
   * @param {{signal?: AbortSignal}} options Cancellation.
   * @returns {Promise<object>} The outcome.
   */
  async runItem(item, state, options) {
    const announce = (phase) => { this.emit('plugin-updater/row-phase', { name: item.name, phase }) }
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
        onPhase: announce,
        // Approval is decided against the repositories the user trusted, from
        // the keys the failed run itself reported.
        decideApproval: async (failure) => decideBuildApproval({
          pendingBuilds: /** @type {{pendingBuilds?: string[]}} */ (failure.value ?? {}).pendingBuilds,
          output: /** @type {{result?: {packageResult?: {output?: string}}}} */ (failure.value ?? {}).result?.packageResult?.output,
          repository: parsed.repository,
          trustedRepositories: this.config().trustedRepositories,
        }),
        approveBuilds: (keys, spec) => this.pluginManager.installBundle(spec, { approvedBuilds: keys }),
      })
    } else {
      const identity = /** @type {{available?: string}} */ (state.identity ?? {})
      if (identity.available === undefined) throw new Error(`${item.name} has no target version`)
      result = await updateRegistry({ name: item.name, version: identity.available, host: this.pluginManager, onPhase: announce })
    }
    this.noteSpecRestore(item.name, result)
    this.noteRestart(item.name, result)
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
    const nested = /** @type {{result?: {application?: string}, application?: string, restore?: {application?: string}}} */ (result)
    const application = nested.result?.application ?? nested.application
    if (application !== 'restart-required') return
    if (this.restartRequired.includes(name)) return
    this.restartRequired.push(name)
    this.emit('plugin-updater/restart-required', { name })
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
