// The wire contribution, reachable as `dsh-plugin-updater/remote`. The browser
// module table resolves only platform seeds, materialized modules, and factories
// keyed by the specifier with a trailing `/client` removed, so this face needs
// its own registration: a `require` of a `/remote` subpath is never served by
// the bundle's own id.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-updater/remote',
  factory(require) {
    const { z } = require('zod')

      /** The package identity carried by every descriptor. */
      const PACKAGE_NAME = 'dsh-plugin-updater'

      /** The Cordis service key the descriptors address. */
      const SERVICE_NAME = 'pluginUpdater'

      /**
       * A value a caller may omit.
       * @param {object} parameter Parameter entry.
       * @returns {boolean} True when undefined is accepted.
       */
      function optional(parameter) {
        return parameter.source === 'json' && parameter.acceptsUndefined === true
      }

      /**
       * Named-argument parsing and JSON Schema projection for one method.
       */
      class NamedInput {
        /**
         * @param {object[]} parameters Parameter entries.
         * @param {boolean} strict Whether undeclared fields are rejected.
         * @param {object} zod The zod namespace.
         */
        constructor(parameters, strict, zod) {
          this.parameters = parameters
          this.strict = strict
          this.zod = zod
        }

        /**
         * The codec a parameter is validated with.
         * @param {object} parameter Parameter entry.
         * @returns {object} Its schema spec.
         */
        codec(parameter) {
          return this.strict ? parameter.strictCodec : parameter.codec
        }

        /**
         * The parser, built once.
         * @returns {object} A zod object schema over the wire names.
         */
        create() {
          this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter) => {
            const value = this.codec(parameter).create()
            return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()]
          })))
          return this.schema
        }

        /**
         * The tool-schema projection, or why it is unavailable.
         * @returns {{jsonSchema?: object, jsonSchemaError?: string}} The projection.
         */
        project() {
          if (this.projection !== undefined) return this.projection
          const unavailable = this.parameters.find((parameter) => this.codec(parameter).jsonSchema === undefined)
          if (unavailable !== undefined) {
            return (this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for ${unavailable.wire}` })
          }
          return (this.projection = {
            jsonSchema: {
              type: 'object',
              properties: Object.fromEntries(this.parameters.map((parameter) => [parameter.wire, {
                ...this.codec(parameter).jsonSchema,
                ...parameter.description === undefined ? {} : { description: parameter.description },
              }])),
              required: this.parameters.filter((parameter) => !optional(parameter)).map((parameter) => parameter.wire),
              additionalProperties: false,
            },
          })
        }

        /** @returns {object|undefined} The projected schema. */
        get jsonSchema() { return this.project().jsonSchema }

        /** @returns {string|undefined} Why projection failed. */
        get jsonSchemaError() { return this.project().jsonSchemaError }
      }

      /**
       * Lazily projects a result codec's JSON Schema.
       */
      class ResultValue {
        /** @param {object} spec Result codec spec. */
        constructor(spec) { this.spec = spec }
        /** @returns {string} The codec mode. */
        get mode() { return this.spec.mode }
        /** @returns {string} The canonical type symbol. */
        get typeSymbol() { return this.spec.typeSymbol }
        /** @returns {unknown} The schema factory. */
        get create() { return this.spec.create }
        /** @returns {unknown} The decoder, when the codec has one. */
        get decode() { return this.spec.decode }
        /** @returns {unknown} The encoder, when the codec has one. */
        get encode() { return this.spec.encode }
        /** @returns {string|undefined} The result description. */
        get description() { return this.spec.description }
        /** @returns {string|undefined} Why projection failed. */
        get jsonSchemaError() { return this.spec.jsonSchemaError }
        /**
         * @returns {object|undefined} The projected schema.
         */
        get jsonSchema() {
          if (this.projection === undefined) {
            const schema = this.spec.jsonSchema
            this.projection = { value: schema === undefined ? undefined : { ...schema, description: this.spec.description } }
          }
          return this.projection.value
        }
      }

      /**
       * Turn a method specification into descriptors and callable client methods.
       */
      class RemoteInfo {
        /**
         * @param {{package: string, methods: Record<string, object>}} spec Method specification.
         * @param {object} zod The zod namespace.
         */
        constructor(spec, zod) {
          this.spec = spec
          this.zod = zod
        }

        /** @returns {string} The owning package. */
        get package() { return this.spec.package }

        /** @returns {object[]} The invocation descriptors. */
        get descriptors() { return this.resolve().descriptors }

        /** @returns {Record<string, object>} Callable methods by endpoint. */
        get methods() { return this.resolve().methods }

        /**
         * Build the descriptors and methods once.
         * @returns {{descriptors: object[], methods: Record<string, object>}} The index.
         */
        resolve() {
          if (this.index !== undefined) return this.index
          const zod = this.zod
          const descriptors = []
          const methods = Object.create(null)
          for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
            const separator = endpoint.indexOf('/')
            const namespace = endpoint.slice(0, separator)
            const method = endpoint.slice(separator + 1)
            const parameters = definition.parameters.map((parameter) => ({ ...parameter, wire: parameter.wire ?? parameter.name }))
            const descriptor = {
              ...definition,
              id: `${this.spec.package}#${endpoint}`,
              namespace,
              method,
              parameters,
              result: definition.result.description === undefined ? definition.result : new ResultValue(definition.result),
            }
            if (definition.invocation.kind === 'direct') {
              const inputs = []
              const direct = Object.assign(descriptor, {
                /**
                 * @param {{strict?: boolean}} [options] Consumer strictness.
                 * @returns {object} The cached named-input view.
                 */
                input(options) {
                  const strict = options?.strict === true
                  return (inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod))
                },
                /**
                 * Invoke the mounted namespace method with named wire arguments.
                 * @param {object} remote The mounted remote namespace.
                 * @param {object} input Named wire arguments.
                 * @param {AbortSignal} [signal] Invocation lifetime.
                 * @returns {Promise<unknown>} The carrier-decoded result.
                 */
                invoke(remote, input, signal) {
                  const named = input
                  const values = parameters.map((parameter) => named[parameter.wire])
                  if (definition.cancellation !== undefined) values.push(signal)
                  const receiver = Reflect.get(remote, namespace)
                  const call = Reflect.get(receiver, method)
                  return call.apply(receiver, values)
                },
              })
              methods[endpoint] = direct
            }
            descriptors.push(descriptor)
          }
          return (this.index = { descriptors, methods })
        }
      }

      /**
       * Build one codec descriptor.
       * @param {string} name Canonical type name.
       * @param {() => object} create Schema factory.
       * @returns {object} The codec spec.
       */
      const codec = (name, create) => ({ mode: 'strict', typeSymbol: `${PACKAGE_NAME}#${name}`, create })

      /**
       * Build one parameter entry.
       * @param {string} name Wire name.
       * @param {object} schema Zod schema.
       * @param {string} typeName Canonical type name.
       * @returns {object} The parameter entry.
       */
      const parameter = (name, schema, typeName) => ({
        name,
        source: 'json',
        codec: codec(typeName, () => schema),
        strictCodec: codec(typeName, () => schema),
      })

      /** A request naming no candidate. */
      const EmptyRequest = z.object({}).strict()

      /** A request naming one candidate. */
      const NameRequest = z.object({ name: z.string().min(1) }).strict()

      /** A request carrying a partial settings write. */
      const ConfigWriteRequest = z.object({
        trustedRepositories: z.array(z.string()).optional(),
        ignoredUpdates: z.array(z.object({ name: z.string(), identity: z.string() })).optional(),
      }).strict()

      /** A request deciding one pending build approval. */
      const BuildDecisionRequest = z.object({
        name: z.string().min(1),
        decision: z.enum(['allow', 'always-allow', 'decline']),
      }).strict()

      const RunCurrent = z.object({
        name: z.string(),
        step: z.string(),
        requestId: z.string(),
      })

      const RunResult = z.object({
        name: z.string(),
        outcome: z.string(),
        reason: z.string().optional(),
      })

      const Run = z.object({
        startedAt: z.number(),
        current: RunCurrent.optional(),
        results: z.array(RunResult),
      })

      const Approval = z.object({
        name: z.string(),
        repository: z.string(),
        keys: z.array(z.string()),
        targetCommit: z.string(),
      })

      /** The pending-state snapshot. */
      const Snapshot = z.object({
        updates: z.array(z.any()),
        reloads: z.array(z.any()),
        unchecked: z.array(z.any()),
        ignored: z.array(z.any()),
        total: z.number(),
        checkedAt: z.number().optional(),
        current: z.boolean().optional(),
        lastFailure: z.string().optional(),
        restartRequired: z.array(z.string()).optional(),
        specRestoreFailed: z.array(z.object({ name: z.string(), reason: z.string() })).optional(),
        cache: z.object({ bytes: z.number(), repositories: z.number(), limitBytes: z.number() }).optional(),
        trustedRepositories: z.array(z.string()).optional(),
        ignoredUpdates: z.array(z.object({ name: z.string(), identity: z.string() })).optional(),
        running: z.boolean().optional(),
        run: Run.optional(),
        approvals: z.array(Approval).optional(),
      })

      /** The outcome of one update. */
      const Outcome = z.object({
        outcome: z.string(),
        step: z.string().optional(),
        reason: z.string().optional(),
        approved: z.array(z.string()).optional(),
        needsApproval: z.array(z.string()).optional(),
        output: z.object({ text: z.string(), truncated: z.boolean(), exitCode: z.number().optional() }).optional(),
        result: z.any().optional(),
        restore: z.any().optional(),
      })

      /** The result of a cancellation request. */
      const CancelResult = z.object({ cancelled: z.boolean() })

      /** The outcome of a queue. */
      const BatchOutcome = z.object({
        results: z.array(z.object({ name: z.string(), outcome: z.string(), result: z.any().optional() })),
        cancelled: z.boolean(),
        skippedIgnored: z.number().optional(),
      })

      const BuildDecisionResult = z.object({
        snapshot: Snapshot,
        result: Outcome.optional(),
      })

      /** The invocation facts every method shares. */
      const base = { service: SERVICE_NAME, invocation: { kind: 'direct' } }

      /** The method specification. */
      const spec = {
        package: PACKAGE_NAME,
        methods: {
          'pluginUpdater/snapshot': {
            ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/refresh': {
            ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/updateOne': {
            ...base, parameters: [parameter('request', NameRequest, 'NameRequest')], result: codec('Outcome', () => Outcome),
          },
          'pluginUpdater/updateAll': {
            ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('BatchOutcome', () => BatchOutcome),
          },
          'pluginUpdater/cancel': {
            ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('CancelResult', () => CancelResult),
          },
          'pluginUpdater/saveConfig': {
            ...base, parameters: [parameter('request', ConfigWriteRequest, 'ConfigWriteRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/clearCache': {
            ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/recheck': {
            ...base, parameters: [parameter('request', NameRequest, 'NameRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/trustRepository': {
            ...base, parameters: [parameter('request', NameRequest, 'NameRequest')], result: codec('Snapshot', () => Snapshot),
          },
          'pluginUpdater/decideBuild': {
            ...base,
            parameters: [parameter('request', BuildDecisionRequest, 'BuildDecisionRequest')],
            result: codec('BuildDecisionResult', () => BuildDecisionResult),
          },
        },
      }

      /** The client-facing face. */
      const remote = new RemoteInfo(spec, z)

      /** The host-facing face, registered with `ctx.typert.register`. */
      const host = {
        package: PACKAGE_NAME,
        face: 'host',
        schemas: [],
        get invocations() { return remote.descriptors },
        model: { services: [], events: [], objects: [] },
      }

    return { remote, host, PACKAGE_NAME, SERVICE_NAME }
  },
})

window.__ModuleLoader__.load({
  id: 'dsh-plugin-updater',
  factory(require) {
    const React = require('react')
    const { remote } = require('dsh-plugin-updater/remote')
    const { useEffect, useRef, useState } = React

    /** The panel id shared by the footer entry and the panel it opens. */
    const PANEL_ID = 'plugin-updater'
    /** Longest package manager excerpt a row keeps, matching the host's own cap. */
    const LOG_LIMIT = 8000
    /** How often the snapshot is read while an attempt is running. */
    const POLL_MS = 500
    /** How long a plugin manager change waits before the snapshot is read. */
    const CHANGE_DEBOUNCE_MS = 250
    /** How long streamed output waits before it is painted. */
    const LOG_FLUSH_MS = 100
    /** How long a toast stays before it fades, and how long a failure stays. */
    const TOAST_MS = 5000
    const TOAST_FAILURE_MS = 8000

    const strings = {
      'actions.cancel': 'Cancel',
      'actions.updateAll': 'Update all',
      'approval.allow': 'Allow and install',
      'approval.always': 'Always allow {{repository}}',
      'approval.body': '{{name}} needs to run a build script from {{repository}}.',
      'approval.decline': 'Not now',
      'approval.keys': 'Entries that need approval',
      'approval.title': 'Build script approval',
      'entry.checkFailed': 'A plugin could not be checked',
      'entry.countAria': '{{count}} plugins need attention',
      'entry.label': 'Plugin Updater',
      'entry.notCurrent': 'Not checked since the last failure',
      'entry.progress': 'An update is running',
      'entry.refresh': 'Check for plugin updates',
      'error.generic': 'Something went wrong: {{reason}}',
      'header.attention': '{{count}} plugins need attention',
      'header.attentionOne': '1 plugin needs attention',
      'header.checkFailed': 'The last check failed',
      'header.current': 'Everything is up to date',
      'header.lastChecked': 'Last checked at {{time}}',
      'header.notCurrent': 'The last check failed: {{reason}}',
      'header.notCurrentUnknown': 'The last check failed',
      'header.unknown': 'No successful check yet',
      'list.allCurrent': 'Everything is up to date.',
      'list.checkFailed': 'Check again to update the list.',
      'list.checking': 'Checking…',
      'list.hideIgnored': 'Hide',
      'list.ignoredCount': '{{count}} ignored',
      'list.ignoredTitle': 'Ignored updates',
      'list.retry': 'Check again',
      'list.reviewIgnored': 'Review',
      'list.unknown': 'No successful check yet.',
      'notice.cancelled': '{{name}} cancelled',
      'notice.dismiss': 'Dismiss',
      'notice.failed': '{{name}} failed',
      'notice.needsApproval': '{{name}} needs build approval',
      'notice.reloaded': '{{name}} reloaded',
      'notice.restored': '{{name}} restored to the previous version',
      'notice.updated': '{{name}} updated',
      'phase.approved': 'Build script approved',
      'phase.cancelled': 'Cancelled',
      'phase.cancelling': 'Cancelling',
      'phase.checking': 'Checking',
      'phase.failed': 'Failed',
      'phase.installing': 'Installing',
      'phase.needsApproval': 'Needs approval',
      'phase.queued': 'Queued',
      'phase.reloaded': 'Reloaded',
      'phase.reloading': 'Reloading',
      'phase.removing': 'Removing',
      'phase.restored': 'Restored',
      'phase.restoring': 'Restoring',
      'phase.running': 'Working',
      'phase.updated': 'Updated',
      'restart.required': 'Restart DeepSeek Harness to load the updated plugins.',
      'row.commitOne': '1 new commit',
      'row.commits': '{{count}} new commits',
      'row.dismiss': 'Dismiss',
      'row.hideNotes': 'Hide changes',
      'row.hideOutput': 'Hide output',
      'row.ignore': 'Ignore',
      'row.notChecked': 'Not checked',
      'row.notesNone': 'No changes were found.',
      'row.notesUnavailable': 'Changes could not be loaded: {{reason}}',
      'row.reload': 'Reload',
      'row.reloadHint': 'Files changed after the application started.',
      'row.retry': 'Try again',
      'row.showNotes': 'Show changes',
      'row.showOutput': 'Show output',
      'row.sourceGit': 'GitHub',
      'row.sourceLocal': 'Local',
      'row.sourceRegistry': 'npm',
      'row.specRestoreFailed': 'The saved version could not be reset, so this plugin may stop reporting updates: {{reason}}',
      'row.trust': 'Trust this repository',
      'row.update': 'Update',
      'settings.cacheClear': 'Clear cache',
      'settings.cacheDescription': 'Copies of git repositories, cached so release notes load faster.',
      'settings.cacheTitle': 'Change cache',
      'settings.cacheUsage': '{{used}} of {{limit}} used by {{count}} repositories.',
      'settings.ignoredClear': 'Stop ignoring',
      'settings.ignoredEmpty': 'No ignored updates.',
      'settings.ignoredTitle': 'Ignored updates',
      'settings.remove': 'Remove',
      'settings.trustedAdd': 'Add repository',
      'settings.trustedDescription': 'Build scripts are approved automatically only for these repositories. Every other repository asks first.',
      'settings.trustedEmpty': 'No trusted repositories. Every build script asks first.',
      'settings.trustedInvalid': 'Enter one repository as owner/repo or host/owner/repo. Trust is per repository, not per account.',
      'settings.trustedPlaceholder': 'github.com/owner/repo',
      'settings.trustedTitle': 'Trusted repositories',
      'summary.cancelled': '{{count}} cancelled',
      'summary.failed': '{{count}} failed',
      'summary.needsApproval': '{{count}} needs approval',
      'summary.reloaded': '{{count}} reloaded',
      'summary.restored': '{{count}} restored',
      'summary.skippedIgnored': '{{count}} ignored skipped',
      'summary.specRestoreFailed': '{{count}} plugin(s) may stop reporting updates because the saved version could not be reset',
      'summary.updated': '{{count}} updated',
      'summary.viewDetails': 'View details',
      'tabs.label': 'Plugin Updater sections',
      'tabs.settings': 'Settings',
      'tabs.updates': 'Updates',
      'toolbar.checkNow': 'Check now',
    }

    /**
     * Resolve one string, filling the named placeholders.
     * @param {string} key Dictionary key.
     * @param {object} [vars] Values to interpolate.
     * @returns {string} The text.
     */
    function t(key, vars) {
      const template = strings[key] ?? key
      if (vars === undefined) return template
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
    }

    /**
     * Render a timestamp as the user's local clock time.
     * @param {number} at Epoch milliseconds.
     * @returns {string} Local time.
     */
    function formatClock(at) {
      return new Date(at).toLocaleTimeString()
    }

    /**
     * The source chip label for one row.
     * @param {object} row Row model.
     * @param {(key: string, vars?: object) => string} translate String lookup.
     * @returns {string} The label.
     */
    function sourceLabel(row, translate) {
      if (row.kind === 'registry') return translate('row.sourceRegistry')
      if (row.kind === 'git') return translate('row.sourceGit')
      if (row.kind === 'local') return translate('row.sourceLocal')
      return ''
    }

    /**
     * The version or commit line for one row.
     * @param {object} row Row model.
     * @param {(key: string, vars?: object) => string} translate String lookup.
     * @returns {string} The line, or an empty string.
     */
    function versionLine(row, translate) {
      if (row.available !== undefined && row.installed !== undefined) return row.installed + ' \u2192 ' + row.available
      if (row.available !== undefined) return String(row.available)
      if (row.commits !== undefined) {
        return row.commits === 1 ? translate('row.commitOne') : translate('row.commits', { count: row.commits })
      }
      return row.installed === undefined ? '' : String(row.installed)
    }

    /**
     * The label for one progress step.
     * @param {string|undefined} step Step name.
     * @param {(key: string) => string} translate String lookup.
     * @returns {string} The label.
     */
    function stepLabel(step, translate) {
      if (step === 'checking') return translate('phase.checking')
      if (step === 'removing') return translate('phase.removing')
      if (step === 'installing') return translate('phase.installing')
      if (step === 'restoring') return translate('phase.restoring')
      if (step === 'reloading') return translate('phase.reloading')
      if (step === 'cancelling') return translate('phase.cancelling')
      return translate('phase.running')
    }

    /**
     * The label for one settled outcome.
     * @param {string|undefined} outcome Outcome name.
     * @param {(key: string) => string} translate String lookup.
     * @returns {string} The label.
     */
    function outcomeLabel(outcome, translate) {
      if (outcome === 'updated') return translate('phase.updated')
      if (outcome === 'reloaded') return translate('phase.reloaded')
      if (outcome === 'restored') return translate('phase.restored')
      if (outcome === 'failed') return translate('phase.failed')
      if (outcome === 'cancelled') return translate('phase.cancelled')
      if (outcome === 'needsApproval') return translate('phase.needsApproval')
      return translate('phase.failed')
    }

    /**
     * The badge a row shows, when it has one.
     * @param {object} row Row model.
     * @param {(key: string, vars?: object) => string} translate String lookup.
     * @returns {{tone: string, label: string}|undefined} The badge.
     */
    function statusOf(row, translate) {
      if (row.approval !== undefined) return { tone: 'warn', label: translate('phase.needsApproval') }
      if (row.state === 'running') return { tone: 'info', label: stepLabel(row.step, translate) }
      if (row.state === 'queued') return { tone: 'muted', label: translate('phase.queued') }
      if (row.state === 'settled' || row.state === 'failed') {
        const outcome = row.outcome
        const tone = outcome === 'failed'
          ? 'error'
          : outcome === 'needsApproval' || outcome === 'restored'
            ? 'warn'
            : outcome === 'cancelled'
              ? 'muted'
              : 'success'
        return { tone, label: outcomeLabel(outcome, translate) }
      }
      if (row.state === 'failed-check') return { tone: 'error', label: translate('row.notChecked') }
      return undefined
    }

    /**
     * The rows the panel shows for a snapshot, before session state is applied.
     *
     * Rebuilt from the snapshot on every reload, which is why anything that must
     * outlive an update has to come from the snapshot rather than from the update
     * result the row briefly carried. A saved spec that could not be reset is the
     * case that matters: while it is pinned, detection compares that commit with
     * itself and reports the plugin as current forever.
     * @param {object} state Snapshot.
     * @returns {object[]} Rows.
     */
    function rowsFromSnapshot(state) {
      const rows = []
      const trusted = new Set((state.trustedRepositories ?? []).map((entry) => String(entry).toLowerCase()))
      const pinned = new Map((state.specRestoreFailed ?? []).map((entry) => [entry.name, entry.reason]))
      const warn = (name) => (pinned.has(name) ? { specRestoreFailed: pinned.get(name) } : {})
      const isTrusted = (repository) => typeof repository === 'string' && trusted.has(repository.toLowerCase())
      for (const update of state.updates ?? []) {
        rows.push({
          name: update.name,
          kind: update.kind,
          action: 'update',
          installed: update.installed,
          available: update.identity?.available,
          commits: update.identity?.commits,
          commit: update.identity?.commit,
          notes: update.notes,
          repository: update.repository,
          trusted: isTrusted(update.repository),
          state: 'idle',
          ...warn(update.name),
        })
      }
      for (const reload of state.reloads ?? []) {
        rows.push({
          name: reload.name,
          kind: 'local',
          action: 'reload',
          installed: reload.installed,
          trusted: false,
          state: 'idle',
          ...warn(reload.name),
        })
      }
      for (const failed of state.unchecked ?? []) {
        rows.push({
          name: failed.name,
          kind: failed.kind,
          action: 'retry',
          installed: failed.installed,
          repository: failed.repository,
          trusted: isTrusted(failed.repository),
          reason: failed.reason,
          state: 'failed-check',
          ...warn(failed.name),
        })
      }
      return rows
    }

    /**
     * The one-line summary a queue produces.
     *
     * A batch that leaves a saved spec pinned reports as many plugins updated, so
     * without its own count the run reads as clean and the user has no route to
     * the detail.
     * @param {object[]|undefined} results One outcome per candidate.
     * @param {number} [skipped] How many ignored updates were left alone.
     * @param {(key: string, vars?: object) => string} translate String lookup.
     * @returns {string|undefined} The summary, or undefined when there is nothing to say.
     */
    function summaryNoticeOf(results, skipped = 0, translate) {
      if (!Array.isArray(results) || results.length === 0) return undefined
      const counts = { updated: 0, reloaded: 0, restored: 0, needsApproval: 0, failed: 0, cancelled: 0 }
      const pinned = results.filter((entry) => entry && typeof entry.specRestoreFailed === 'string').length
      for (const entry of results) {
        const outcome = entry && entry.outcome
        if (outcome !== undefined && Object.hasOwn(counts, outcome)) counts[outcome] += 1
      }
      const parts = []
      if (counts.updated > 0) parts.push(translate('summary.updated', { count: counts.updated }))
      if (counts.reloaded > 0) parts.push(translate('summary.reloaded', { count: counts.reloaded }))
      if (counts.restored > 0) parts.push(translate('summary.restored', { count: counts.restored }))
      if (counts.needsApproval > 0) parts.push(translate('summary.needsApproval', { count: counts.needsApproval }))
      if (counts.failed > 0) parts.push(translate('summary.failed', { count: counts.failed }))
      if (counts.cancelled > 0) parts.push(translate('summary.cancelled', { count: counts.cancelled }))
      if (skipped > 0) parts.push(translate('summary.skippedIgnored', { count: skipped }))
      if (pinned > 0) parts.push(translate('summary.specRestoreFailed', { count: pinned }))
      return parts.length === 0 ? undefined : parts.join(', ')
    }

    /**
     * Clone the facts a session keeps about a row after it leaves the snapshot.
     * @param {object} row Row model.
     * @returns {object} A detached copy.
     */
    function cloneRow(row) {
      return {
        name: row.name,
        kind: row.kind,
        action: row.action,
        installed: row.installed,
        available: row.available,
        commits: row.commits,
        commit: row.commit,
        notes: row.notes,
        repository: row.repository,
        trusted: row.trusted,
        reason: row.reason,
        specRestoreFailed: row.specRestoreFailed,
      }
    }

    /**
     * Merge one base row with its session attempt.
     * @param {object} row Base row.
     * @param {object|undefined} attempt Session attempt.
     * @param {object[]} approvals Pending approvals.
     * @returns {object} The merged row.
     */
    function mergeRow(row, attempt, approvals) {
      const approval = approvals.find((entry) => entry.name === row.name)
      if (attempt === undefined) {
        return { ...row, approval, state: row.state === 'failed-check' ? 'failed-check' : 'idle' }
      }
      const identity = attempt.row === undefined ? row : { ...row, ...attempt.row }
      if (attempt.state === 'running') {
        return {
          ...identity,
          state: 'running',
          step: attempt.step,
          output: attempt.output,
          approval,
          specRestoreFailed: attempt.specRestoreFailed ?? row.specRestoreFailed,
        }
      }
      if (attempt.state === 'queued') {
        return { ...identity, state: 'queued', approval }
      }
      return {
        ...identity,
        state: attempt.state === 'failed' ? 'failed' : 'settled',
        outcome: attempt.outcome,
        reason: attempt.reason === undefined ? row.reason : attempt.reason,
        output: attempt.output,
        needsApproval: attempt.needsApproval,
        approved: attempt.approved,
        approval,
        specRestoreFailed: attempt.specRestoreFailed === undefined ? row.specRestoreFailed : attempt.specRestoreFailed,
      }
    }

    /**
     * The identity a row currently offers.
     *
     * Dismissal is about one offered update, not about the plugin: a different
     * commit or version must be able to appear after the result was dismissed.
     * @param {object|undefined} row Row model.
     * @returns {string} The identity, or '*' when none is known.
     */
    function identityOf(row) {
      if (row === undefined || row === null) return '*'
      if (row.kind === 'git') return typeof row.commit === 'string' ? row.commit : '*'
      if (row.available !== undefined) return String(row.available)
      if (row.installed !== undefined) return 'v:' + row.installed
      return '*'
    }

    /**
     * The rows the panel shows for the base snapshot plus the session.
     * @param {object[]} baseRows Rows from the snapshot.
     * @param {object} session Session state.
     * @param {object[]} approvals Pending approvals.
     * @param {string} phase Current panel phase.
     * @returns {object[]} The merged rows.
     */
    function rowsOf(baseRows, session, approvals, phase) {
      const rows = []
      const seen = new Set()
      for (const row of baseRows) {
        seen.add(row.name)
        rows.push(mergeRow(row, session.attempts[row.name], approvals))
      }
      for (const [name, attempt] of Object.entries(session.attempts)) {
        if (seen.has(name)) continue
        const row = attempt.row ?? session.rowCache?.[name] ?? { name, kind: 'unknown', action: 'update', state: 'idle', trusted: false }
        rows.push(mergeRow(row, attempt, approvals))
      }
      // Dismissal applies to the offered update, not to the plugin: a later,
      // different update for the same name must be able to appear again.
      const visible = rows.filter((row) => {
        const dismissed = session.dismissed[row.name]
        if (dismissed === undefined) return true
        return dismissed !== '*' && dismissed !== identityOf(row)
      })
      if (phase !== 'updating' || session.batch !== true) return visible
      return visible.map((row) => {
        if (row.state !== 'idle' || row.action === 'retry' || row.approval !== undefined) return row
        return { ...row, state: 'queued' }
      })
    }

    /**
     * The panel header model.
     * @param {object} base Base snapshot state.
     * @param {(key: string, vars?: object) => string} translate String lookup.
     * @returns {object} The header.
     */
    function headerOf(base, translate) {
      const total = base.total ?? 0
      const summary = total > 0
        ? (total === 1 ? translate('header.attentionOne') : translate('header.attention', { count: total }))
        : base.current === false
          ? translate('header.checkFailed')
          : base.checkedAt === undefined ? translate('header.unknown') : translate('header.current')
      const notCurrent = base.current === false
        ? (base.lastFailure === undefined
          ? translate('header.notCurrentUnknown')
          : translate('header.notCurrent', { reason: base.lastFailure }))
        : undefined
      return {
        summary,
        lastChecked: base.checkedAt === undefined ? undefined : translate('header.lastChecked', { time: formatClock(base.checkedAt) }),
        notCurrent,
      }
    }

    /**
     * Create the client store.
     *
     * The store owns every fact that must outlive a snapshot reload: the running
     * attempt, its streamed output, the settled outcome, the notice, and the
     * dismissed rows. The host snapshot is only the base layer, so adopting one
     * never erases the feedback a user is reading.
     * @param {{
     *   remote: object,
     *   layout: object,
     *   translate?: (key: string, vars?: object) => string,
     *   schedule?: (fn: () => void, ms: number) => unknown,
     *   cancelSchedule?: (id: unknown) => void
     * }} deps Client services and test seams.
     * @returns {object} The store.
     */
    function createStore(deps) {
      const remoteService = deps.remote
      const layout = deps.layout
      const translate = deps.translate ?? t
      const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms))
      const cancelSchedule = deps.cancelSchedule ?? ((id) => clearTimeout(id))

      const listeners = new Set()
      const requestNames = Object.create(null)
      const bufferedLogs = Object.create(null)
      const disposers = []
      let disposed = false
      let base = emptyBase()
      let session = emptySession()
      let phase = 'idle'
      let busy = false
      let noticeSequence = 0
      let changeTimer
      let pollTimer
      let logTimer
      let view = buildView()

      /** @returns {object} The base layer of the panel state. */
      function emptyBase() {
        return {
          rows: [], ignored: [], total: 0, checkedAt: undefined, current: undefined,
          lastFailure: undefined, restartRequired: [], specRestoreFailed: [], cache: undefined,
          trustedRepositories: [], ignoredUpdates: [], run: undefined, approvals: [], running: false,
        }
      }

      /** @returns {object} The session layer of the panel state. */
      function emptySession() {
        return {
          attempts: {}, dismissed: {}, rowCache: {}, batch: false,
          notice: undefined, error: undefined, announcement: '',
        }
      }

      /** @returns {object} The immutable view components render. */
      function buildView() {
        const rows = rowsOf(base.rows, session, base.approvals ?? [], phase)
        const pending = rows.filter((row) => (row.action === 'update' || row.action === 'reload')
          && row.state === 'idle' && row.approval === undefined)
        // The total follows the rows the user can actually see. A settled row
        // still counts unless its update or reload actually applied; a
        // dismissed row is gone from the list and from the count.
        const total = rows.filter((row) => {
          if (row.state === 'idle' || row.state === 'failed-check' || row.state === 'queued' || row.state === 'running') return true
          if (row.state !== 'settled' && row.state !== 'failed') return false
          return row.outcome !== 'updated' && row.outcome !== 'reloaded'
        }).length
        return {
          phase,
          busy,
          rows,
          pending,
          total,
          checkedAt: base.checkedAt,
          current: base.current,
          lastFailure: base.lastFailure,
          restartRequired: base.restartRequired ?? [],
          ignored: base.ignored ?? [],
          ignoredUpdates: base.ignoredUpdates ?? [],
          trustedRepositories: base.trustedRepositories ?? [],
          cache: base.cache,
          notice: session.notice,
          error: session.error,
          announcement: session.announcement,
          header: headerOf({ ...base, total }, translate),
          canUpdateAll: pending.length > 0 && phase !== 'updating' && busy !== true,
          updating: phase === 'updating',
          checking: phase === 'checking' || base.running === true,
        }
      }

      /** @returns {void} Notify every subscriber with a fresh view. */
      function publish() {
        if (disposed) return
        view = buildView()
        for (const listener of listeners) listener()
      }

      /**
       * Replace the base layer from one host snapshot.
       * @param {object} state Snapshot.
       * @returns {void}
       */
      function adopt(state) {
        base = {
          rows: rowsFromSnapshot(state),
          ignored: state.ignored ?? [],
          total: state.total ?? 0,
          checkedAt: state.checkedAt,
          current: state.current,
          lastFailure: state.lastFailure,
          restartRequired: state.restartRequired ?? [],
          specRestoreFailed: state.specRestoreFailed ?? [],
          cache: state.cache,
          trustedRepositories: state.trustedRepositories ?? [],
          ignoredUpdates: state.ignoredUpdates ?? [],
          run: state.run,
          approvals: state.approvals ?? [],
          running: state.running === true,
        }
        publish()
      }

      /**
       * Unwrap the host's result envelope.
       * @param {unknown} result Host result.
       * @returns {unknown} The value.
       */
      function unwrap(result) {
        if (result !== null && typeof result === 'object' && 'ok' in result) {
          if (result.ok === true) return result.value
          throw new Error(result.error?.message ?? 'the host refused the call')
        }
        return result
      }

      /**
       * Call one host method, keeping failures in the session layer.
       * @param {string} name Method name.
       * @param {object} [request] Request.
       * @param {{quiet?: boolean}} [options] Whether a failure stays silent.
       * @returns {Promise<unknown>} The value, or undefined on failure.
       */
      async function call(name, request, options = {}) {
        try {
          const fn = remoteService.pluginUpdater === undefined ? undefined : remoteService.pluginUpdater[name]
          if (typeof fn !== 'function') throw new Error('the host does not expose ' + name)
          const result = unwrap(await fn(request ?? {}))
          if (options.quiet !== true) session.error = undefined
          return result
        } catch (error) {
          if (options.quiet !== true) {
            session.error = translate('error.generic', {
              reason: error instanceof Error ? error.message : String(error),
            })
            publish()
          }
          return undefined
        }
      }

      /** @returns {void} Drop every settled row. */
      function clearSettled() {
        for (const [name, attempt] of Object.entries(session.attempts)) {
          if (attempt.state === 'settled' || attempt.state === 'failed') delete session.attempts[name]
        }
        session.dismissed = {}
      }

      /**
       * Read the current snapshot without starting detection.
       * @param {{quiet?: boolean}} [options] Whether progress is shown.
       * @returns {Promise<void>}
       */
      async function load(options = {}) {
        if (options.quiet !== true) {
          busy = true
          if (base.checkedAt === undefined && base.rows.length === 0 && phase === 'idle') phase = 'loading'
          publish()
        }
        const state = await call('snapshot', undefined, options)
        if (state !== undefined) adopt(state)
        busy = false
        if (phase === 'loading') phase = 'idle'
        publish()
        if (shouldPoll()) schedulePoll()
      }

      /** @returns {Promise<void>} Start a manual detection and clear settled rows. */
      async function refresh() {
        clearSettled()
        phase = 'checking'
        busy = true
        session.error = undefined
        publish()
        const state = await call('refresh')
        if (state !== undefined) adopt(state)
        phase = 'idle'
        busy = false
        publish()
      }

      /**
       * Build a running attempt from a row.
       * @param {object} row Row model.
       * @param {string} step Initial step.
       * @returns {object} The attempt.
       */
      function runningAttempt(row, step) {
        return {
          state: 'running',
          step,
          row: cloneRow(row),
          output: { text: '', truncated: false },
          requestId: undefined,
        }
      }

      /**
       * Normalise an output payload, keeping the host's tail bound.
       * @param {unknown} output Host or streamed output.
       * @param {object} [previous] The output already collected.
       * @returns {{text: string, truncated: boolean}} The output.
       */
      function normalizeOutput(output, previous) {
        if (output !== undefined && output !== null && typeof output === 'object') {
          const raw = typeof output.text === 'string' ? output.text : ''
          return {
            text: raw.slice(-LOG_LIMIT),
            truncated: output.truncated === true || raw.length > LOG_LIMIT,
          }
        }
        return previous ?? { text: '', truncated: false }
      }

      /**
       * Settle one attempt.
       * @param {string} name Candidate name.
       * @param {object} result Outcome.
       * @returns {void}
       */
      function settleAttempt(name, result) {
        const attempt = session.attempts[name]
        const baseRow = base.rows.find((row) => row.name === name)
        const source = attempt ?? {
          row: baseRow === undefined ? session.rowCache[name] : cloneRow(baseRow),
          needsApproval: undefined,
          approved: undefined,
        }
        const outcome = typeof result?.outcome === 'string' ? result.outcome : 'failed'
        if (typeof attempt?.requestId === 'string') delete requestNames[attempt.requestId]
        session.attempts[name] = {
          ...source,
          state: outcome === 'failed' ? 'failed' : 'settled',
          outcome,
          step: undefined,
          reason: typeof result?.reason === 'string' ? result.reason : undefined,
          needsApproval: Array.isArray(result?.needsApproval) ? result.needsApproval : source.needsApproval,
          approved: Array.isArray(result?.approved) ? result.approved : source.approved,
          specRestoreFailed: result?.specRestoreFailed,
          output: normalizeOutput(result?.output, attempt?.output),
        }
        session.announcement = name + ': ' + outcomeLabel(outcome, translate)
      }

      /**
       * The initial step for a row's source.
       * @param {object} row Row model.
       * @returns {string} The step name.
       */
      function initialStep(row) {
        if (row.kind === 'local') return 'reloading'
        if (row.kind === 'git') return 'removing'
        return 'checking'
      }

      /**
       * Build the notice for one settled candidate.
       * @param {string} name Candidate name.
       * @param {object} result Outcome.
       * @returns {object} The notice.
       */
      function noticeFor(name, result) {
        const outcome = typeof result?.outcome === 'string' ? result.outcome : 'failed'
        const tone = outcome === 'failed'
          ? 'error'
          : outcome === 'needsApproval' || outcome === 'restored'
            ? 'warning'
            : outcome === 'cancelled'
              ? 'info'
              : 'success'
        const text = outcome === 'updated'
          ? translate('notice.updated', { name })
          : outcome === 'reloaded'
            ? translate('notice.reloaded', { name })
            : outcome === 'needsApproval'
              ? translate('notice.needsApproval', { name })
              : outcome === 'restored'
                ? translate('notice.restored', { name })
                : outcome === 'cancelled'
                  ? translate('notice.cancelled', { name })
                  : translate('notice.failed', { name })
        const application = result?.result?.result?.application
          ?? result?.result?.application
          ?? result?.application
        return {
          id: ++noticeSequence,
          tone,
          text,
          detail: typeof result?.reason === 'string' ? result.reason : undefined,
          restart: application === 'restart-required',
        }
      }

      /**
       * Build the notice for a finished queue.
       * @param {object} result Queue outcome.
       * @returns {object} The notice.
       */
      function batchNotice(result) {
        const entries = (result?.results ?? []).map((entry) => ({
          outcome: entry.outcome,
          ...(entry.result ?? {}),
        }))
        const text = summaryNoticeOf(entries, result?.skippedIgnored ?? 0, translate)
        const failed = entries.some((entry) => entry.outcome === 'failed')
        const needs = entries.some((entry) => entry.outcome === 'needsApproval' || entry.outcome === 'restored')
        const cancelled = result?.cancelled === true || entries.some((entry) => entry.outcome === 'cancelled')
        const restart = (result?.results ?? []).some((entry) => {
          const outcome = entry.result ?? {}
          const application = outcome.result?.result?.application
            ?? outcome.result?.application
            ?? outcome.application
          return application === 'restart-required'
        })
        const tone = failed ? 'error' : needs ? 'warning' : cancelled ? 'info' : 'success'
        return {
          id: ++noticeSequence,
          tone,
          text: text ?? translate('phase.cancelled'),
          restart,
        }
      }

      /**
       * Update one candidate.
       * @param {string} name Candidate name.
       * @returns {Promise<void>}
       */
      async function updateOne(name) {
        const row = base.rows.find((entry) => entry.name === name)
        if (row === undefined) return
        const step = initialStep(row)
        clearBufferedLogs()
        session.rowCache[name] = cloneRow(row)
        session.attempts[name] = runningAttempt(row, step)
        session.error = undefined
        session.announcement = name + ': ' + stepLabel(step, translate)
        phase = 'updating'
        busy = true
        publish()
        schedulePoll()
        const result = await call('updateOne', { name })
        const outcome = result ?? { outcome: 'failed', reason: session.error }
        settleAttempt(name, outcome)
        session.notice = noticeFor(name, outcome)
        phase = 'idle'
        busy = false
        stopPolling()
        publish()
        await load({ quiet: true })
      }

      /**
       * Update every pending candidate through the host queue.
       * @returns {Promise<void>}
       */
      async function updateAll() {
        if (phase === 'updating') return
        clearBufferedLogs()
        for (const row of base.rows) {
          if (row.action !== 'retry') session.rowCache[row.name] = cloneRow(row)
        }
        session.batch = true
        session.error = undefined
        phase = 'updating'
        busy = true
        publish()
        schedulePoll()
        const result = await call('updateAll')
        if (result !== undefined) {
          for (const entry of result.results ?? []) {
            settleAttempt(entry.name, entry.result ?? { outcome: entry.outcome })
          }
          session.notice = batchNotice(result)
        } else {
          // The queue failed before reporting: no candidate it had started may
          // stay "running" forever.
          for (const [name, attempt] of Object.entries(session.attempts)) {
            if (attempt.state === 'running') settleAttempt(name, { outcome: 'failed', reason: session.error })
          }
          session.notice = {
            id: ++noticeSequence,
            tone: 'error',
            text: session.error ?? translate('phase.failed'),
          }
        }
        session.batch = false
        phase = 'idle'
        busy = false
        stopPolling()
        publish()
        await load({ quiet: true })
      }

      /**
       * Re-check one failed candidate.
       * @param {string} name Candidate name.
       * @returns {Promise<void>}
       */
      async function recheck(name) {
        const row = base.rows.find((entry) => entry.name === name)
        if (row === undefined) return
        session.attempts[name] = runningAttempt(row, 'checking')
        session.error = undefined
        phase = 'checking'
        busy = true
        publish()
        const state = await call('recheck', { name })
        if (state !== undefined) adopt(state)
        delete session.attempts[name]
        phase = 'idle'
        busy = false
        publish()
      }

      /**
       * Trust the repository a candidate was installed from.
       * @param {string} name Candidate name.
       * @returns {Promise<void>}
       */
      async function trust(name) {
        busy = true
        publish()
        const state = await call('trustRepository', { name })
        if (state !== undefined) adopt(state)
        busy = false
        publish()
      }

      /**
       * Decide a pending build approval.
       * @param {string} name Candidate name.
       * @param {string} decision allow, always-allow, or decline.
       * @returns {Promise<void>}
       */
      async function decideBuild(name, decision) {
        const row = base.rows.find((entry) => entry.name === name) ?? session.rowCache[name]
        clearBufferedLogs()
        if (row !== undefined) session.attempts[name] = runningAttempt(row, 'installing')
        session.error = undefined
        phase = 'updating'
        busy = true
        publish()
        schedulePoll()
        const answer = await call('decideBuild', { name, decision })
        if (answer !== undefined && answer.snapshot !== undefined) adopt(answer.snapshot)
        if (answer !== undefined && answer.result !== undefined) {
          settleAttempt(name, answer.result)
          session.notice = noticeFor(name, answer.result)
        } else {
          delete session.attempts[name]
        }
        phase = 'idle'
        busy = false
        stopPolling()
        publish()
        if (answer !== undefined && answer.result !== undefined) await load({ quiet: true })
      }

      /**
       * Save a configuration patch and adopt the returned snapshot.
       * @param {object} patch Partial configuration.
       * @returns {Promise<void>}
       */
      async function saveConfig(patch) {
        const state = await call('saveConfig', patch)
        if (state !== undefined) adopt(state)
      }

      /**
       * Ignore the update a row offers.
       * @param {object} row Row model.
       * @returns {Promise<void>}
       */
      async function ignore(row) {
        // A git update is identified by its commit, a registry one by its
        // version: several commits can share a version, and ignoring by
        // version would hide a later, different commit.
        const identity = row.kind === 'git' ? row.commit : row.available
        if (identity === undefined) return
        const kept = (base.ignoredUpdates ?? []).filter((entry) => entry.name !== row.name)
        await saveConfig({ ignoredUpdates: [...kept, { name: row.name, identity: String(identity) }] })
      }

      /** @returns {Promise<void>} Clear the clone cache. */
      async function clearCache() {
        const state = await call('clearCache')
        if (state !== undefined) adopt(state)
      }

      /** @returns {Promise<void>} Abandon a running queue. */
      async function cancel() {
        await call('cancel')
      }

      /**
       * Remove one settled row from the panel.
       * @param {string} name Candidate name.
       * @returns {void}
       */
      function dismiss(name) {
        // The approval is still the user's to decide; hiding the row would
        // leave the host holding a request with no way back to it.
        if ((base.approvals ?? []).some((approval) => approval.name === name)) return
        const row = base.rows.find((entry) => entry.name === name)
          ?? session.attempts[name]?.row
          ?? session.rowCache[name]
        delete session.attempts[name]
        session.dismissed[name] = identityOf(row)
        publish()
      }

      /** @returns {void} Dismiss the current notice. */
      function dismissNotice() {
        session.notice = undefined
        publish()
      }

      /** @returns {void} Open the panel and read the current snapshot. */
      function openPanel() {
        layout.selectPanel(PANEL_ID)
        void load()
      }

      /**
       * Resolve a request id to the candidate that owns it.
       * @param {string} requestId Request id from a host event.
       * @returns {string|undefined} The candidate name.
       */
      function nameOfRequest(requestId) {
        if (typeof requestId !== 'string') return undefined
        if (requestNames[requestId] !== undefined) return requestNames[requestId]
        for (const [name, attempt] of Object.entries(session.attempts)) {
          if (attempt.requestId === requestId) return name
        }
        if (base.run?.current?.requestId === requestId) return base.run.current.name
        return undefined
      }

      /**
       * Merge the host run record into the session.
       * @param {object|undefined} run Run record.
       * @returns {void}
       */
      function mergeRun(run) {
        if (run === undefined || run === null) return
        if (run.current !== undefined) {
          const name = run.current.name
          const requestId = run.current.requestId
          if (typeof requestId === 'string') requestNames[requestId] = name
          let attempt = session.attempts[name]
          if (attempt === undefined || attempt.state === 'queued') {
            const row = base.rows.find((entry) => entry.name === name)
              ?? session.rowCache[name]
              ?? { name, kind: 'unknown', action: 'update', state: 'idle', trusted: false }
            attempt = runningAttempt(row, run.current.step)
            session.attempts[name] = attempt
          }
          if (attempt.state === 'running') {
            attempt.step = run.current.step
            if (typeof requestId === 'string') attempt.requestId = requestId
          }
          if (typeof requestId === 'string') flushLogs(requestId, name)
        }
        for (const result of run.results ?? []) {
          const attempt = session.attempts[result.name]
          if (attempt !== undefined && (attempt.state === 'settled' || attempt.state === 'failed')) continue
          settleAttempt(result.name, { outcome: result.outcome, reason: result.reason })
        }
        publish()
      }

      /**
       * Apply one step event from the plugin manager.
       * @param {{requestId?: string, step?: string}} progress Event payload.
       * @returns {void}
       */
      function onStep(progress) {
        if (progress === undefined || progress === null) return
        const name = nameOfRequest(progress.requestId)
        if (name === undefined) return
        const attempt = session.attempts[name]
        if (attempt === undefined || attempt.state !== 'running') return
        if (typeof progress.step !== 'string') return
        attempt.step = progress.step
        session.announcement = name + ': ' + stepLabel(progress.step, translate)
        publish()
      }

      /**
       * Apply one install-state event.
       * @param {{requestId?: string, phase?: string}} progress Event payload.
       * @returns {void}
       */
      function onInstallState(progress) {
        if (progress === undefined || progress === null) return
        onStep({
          requestId: progress.requestId,
          step: progress.phase === 'cancelling' ? 'cancelling' : 'installing',
        })
      }

      /**
       * Buffer one log chunk for a request the run record has not named yet.
       * @param {string} requestId Request id.
       * @param {string} text Chunk text.
       * @returns {void}
       */
      function bufferLog(requestId, text) {
        const known = Object.keys(bufferedLogs)
        // A request this run never names belongs to another operation; keeping
        // one entry per such request would grow without bound.
        if (bufferedLogs[requestId] === undefined && known.length >= 5) delete bufferedLogs[known[0]]
        bufferedLogs[requestId] = ((bufferedLogs[requestId] ?? '') + text).slice(-LOG_LIMIT)
      }

      /** @returns {void} Drop logs buffered for a request this run never named. */
      function clearBufferedLogs() {
        for (const requestId of Object.keys(bufferedLogs)) delete bufferedLogs[requestId]
      }

      /**
       * Attach buffered log chunks once the run names their request.
       * @param {string} requestId Request id.
       * @param {string} name Candidate name.
       * @returns {void}
       */
      function flushLogs(requestId, name) {
        const text = bufferedLogs[requestId]
        if (text === undefined) return
        delete bufferedLogs[requestId]
        appendLog(name, text)
      }

      /**
       * Append streamed output to a running attempt.
       * @param {string} name Candidate name.
       * @param {string} text Chunk text.
       * @returns {void}
       */
      function appendLog(name, text) {
        const attempt = session.attempts[name]
        if (attempt === undefined || attempt.state !== 'running') return
        const existing = attempt.output?.text ?? ''
        const combined = existing + text
        attempt.output = {
          text: combined.slice(-LOG_LIMIT),
          truncated: attempt.output?.truncated === true || combined.length > LOG_LIMIT,
        }
        if (logTimer === undefined) {
          logTimer = schedule(() => {
            logTimer = undefined
            if (disposed) return
            publish()
          }, LOG_FLUSH_MS)
        }
      }

      /**
       * Apply one install-log event.
       * @param {{requestId?: string, text?: string}} chunk Event payload.
       * @returns {void}
       */
      function onLog(chunk) {
        if (chunk === undefined || chunk === null) return
        if (typeof chunk.requestId !== 'string' || typeof chunk.text !== 'string' || chunk.text === '') return
        const name = nameOfRequest(chunk.requestId)
        if (name === undefined) {
          // Another operation's installation is not this panel's to render.
          if (phase === 'updating') bufferLog(chunk.requestId, chunk.text)
          return
        }
        appendLog(name, chunk.text)
      }

      /** @returns {void} Debounce a manager change into a snapshot read. */
      function scheduleChange() {
        if (changeTimer !== undefined) cancelSchedule(changeTimer)
        changeTimer = schedule(() => {
          changeTimer = undefined
          void load({ quiet: true })
        }, CHANGE_DEBOUNCE_MS)
      }

      /** @returns {boolean} Whether the snapshot must keep being polled. */
      function shouldPoll() {
        if (phase === 'updating') return true
        if (base.running === true) return true
        if (base.run !== undefined) return true
        return Object.values(session.attempts).some((attempt) => attempt.state === 'running')
      }

      /** @returns {void} Read the snapshot repeatedly while work is running. */
      function schedulePoll() {
        if (pollTimer !== undefined || disposed) return
        pollTimer = schedule(async () => {
          pollTimer = undefined
          if (disposed) return
          const state = await call('snapshot', undefined, { quiet: true })
          if (state !== undefined) {
            adopt(state)
            mergeRun(state.run)
          }
          if (shouldPoll()) schedulePoll()
        }, POLL_MS)
      }

      /** @returns {void} Stop polling. */
      function stopPolling() {
        if (pollTimer === undefined) return
        cancelSchedule(pollTimer)
        pollTimer = undefined
      }

      /**
       * Subscribe to a forwarded event when the host offers them.
       * @param {string} name Event name.
       * @param {Function} handler Listener.
       * @returns {void}
       */
      function listen(name, handler) {
        if (typeof remoteService.$on !== 'function') return
        try {
          const dispose = remoteService.$on(name, handler)
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch {
          // A host without forwarded events still runs every explicit action.
        }
      }

      listen('plugin-manager/changed', scheduleChange)
      listen('plugin-manager/update-state', onStep)
      listen('plugin-manager/install-state', onInstallState)
      listen('plugin-manager/install-log', onLog)

      const actions = {
        load,
        refresh,
        updateOne,
        updateAll,
        recheck,
        trust,
        decideBuild,
        saveConfig,
        ignore,
        clearCache,
        cancel,
        dismiss,
        dismissNotice,
        openPanel,
      }

      return {
        actions,
        getSnapshot: () => view,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        dispose() {
          disposed = true
          stopPolling()
          if (changeTimer !== undefined) cancelSchedule(changeTimer)
          if (logTimer !== undefined) cancelSchedule(logTimer)
          for (const dispose of disposers.splice(0).reverse()) dispose()
          listeners.clear()
        },
      }
    }

    const styles = `
      .updater-panel { --updater-inset: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
      .updater-page { display: flex; flex-direction: column; width: 100%; max-width: 960px; height: 100%; min-height: 0; margin: 0 auto; padding: 0 var(--updater-inset); box-sizing: border-box; }
      .updater-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-top: 28px; flex: none; }
      .updater-heading { min-width: 0; }
      .updater-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
      .updater-summary { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .updater-headmeta { flex: none; padding-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .updater-notice { margin-top: 16px; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; flex: none; }
      .updater-tabs { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 20px; padding: 4px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-module-platform); width: min(320px, 100%); flex: none; }
      .updater-tabs-indicator { position: absolute; inset: 4px auto 4px 4px; width: calc(50% - 4px); box-sizing: border-box; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); transition: transform 180ms ease; pointer-events: none; }
      .updater-tabs-indicator[data-tab='settings'] { transform: translateX(100%); }
      .updater-tab { position: relative; height: 34px; padding: 0 12px; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; line-height: 20px; cursor: pointer; transition: color 180ms ease; }
      .updater-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); font-weight: 500; }
      @media (hover: hover) { .updater-tab:hover { color: var(--dsw-alias-label-primary); } }
      .updater-tab:focus-visible { outline: none; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }
      .updater-tabpanel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .updater-tabpanel[hidden] { display: none; }
      .updater-updates { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .updater-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px 0 12px; flex: none; }
      .updater-toolbar-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .updater-scroll { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 32px; }
      .updater-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
      .updater-row { display: flex; flex-direction: column; gap: 6px; padding: 12px 2px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
      .updater-row:last-child { border-bottom: 0; }
      .updater-row-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
      .updater-name { font-size: 13.5px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
      .updater-chip { flex: none; padding: 1px 7px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
      .updater-version { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .updater-spacer { flex: 1; }
      .updater-badge { flex: none; padding: 1px 8px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent); border-radius: 999px; font-size: 11px; line-height: 18px; font-weight: 500; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-label-primary); }
      .updater-badge[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent); }
      .updater-badge[data-tone='warn'] { background: var(--dsw-alias-state-warn-tertiary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); }
      .updater-badge[data-tone='error'] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
      .updater-badge[data-tone='muted'] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
      .updater-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 18px; cursor: pointer; }
      .updater-button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      @media (hover: hover) { .updater-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }
      .updater-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .updater-button:disabled { opacity: 0.5; cursor: default; }
      .updater-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
      @media (hover: hover) { .updater-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); } }
      .updater-small { height: 28px; padding: 0 10px; }
      .updater-link { padding: 0; border: 0; background: none; color: var(--dsw-alias-link); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .updater-link:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: 2px; }
      .updater-link:disabled { opacity: 0.5; cursor: default; }
      .updater-iconbutton { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 15px; line-height: 1; cursor: pointer; }
      .updater-iconbutton:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      @media (hover: hover) { .updater-iconbutton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
      .updater-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      .updater-error-text { color: var(--dsw-alias-state-error-primary); }
      .updater-warn { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; }
      .updater-detail { display: flex; flex-direction: column; gap: 4px; }
      .updater-notes { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; margin: 0; padding: 0; list-style: none; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .updater-commit { font-family: var(--ds-font-family-code); font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .updater-output { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); max-height: 220px; overflow: auto; margin: 0; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); font-family: var(--ds-font-family-code); font-size: 11.5px; line-height: 17px; white-space: pre-wrap; word-break: break-word; }
      .updater-approval { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 12px 14px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-state-warn-tertiary); }
      .updater-approval-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 500; }
      .updater-approval-label { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
      .updater-keys { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
      .updater-keys code { display: inline-block; padding: 2px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3); font-family: var(--ds-font-family-code); font-size: 11.5px; overflow-wrap: anywhere; }
      .updater-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .updater-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 32px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .updater-empty p { margin: 0; }
      .updater-ignored { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .updater-ignored-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .updater-ignored-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 12px; line-height: 18px; }
      .updater-ignored-row { display: flex; align-items: center; gap: 8px; }
      .updater-settings { gap: 16px; padding-top: 24px; }
      .updater-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 0.5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl); background: var(--dsw-alias-settings-card-fill); }
      .updater-card-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; }
      .updater-card-desc { margin: 0; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .updater-trusted { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
      .updater-trusted-row { display: flex; align-items: center; gap: 8px; min-height: 34px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
      .updater-trusted-row:last-child { border-bottom: 0; }
      .updater-field { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .updater-input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
      .updater-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-state-business-primary); }
      @media (pointer: coarse) { .updater-input { font-size: 16px; } }
      .updater-error { padding: 10px 12px; border-radius: var(--dsw-radius-md); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 12.5px; line-height: 18px; }
      .updater-banner { padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 18px; }
      .updater-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      .updater-spinner { flex: none; color: var(--dsw-alias-label-tertiary); animation: updater-spin 900ms linear infinite; }
      .updater-footer { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 0 4px; box-sizing: border-box; }
      .updater-footer-main { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; min-height: 32px; padding: 5px 4px; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; line-height: 22px; text-align: left; cursor: pointer; }
      @media (hover: hover) { .updater-footer-main:hover { background: var(--dsw-alias-interactive-bg-hover); } }
      .updater-footer-main:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
      .updater-footer-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .updater-footer-end { display: flex; flex: none; align-items: center; gap: 6px; }
      .updater-footer-count { min-width: 14px; font-size: 12px; color: var(--dsw-alias-label-caption); text-align: right; font-variant-numeric: tabular-nums; }
      .updater-dot { flex: none; width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-warn-primary); }
      .updater-footer-refresh { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-caption); cursor: pointer; }
      @media (hover: hover) { .updater-footer-refresh:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } }
      .updater-footer-refresh:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      .updater-footer-refresh:disabled { cursor: default; }
      .updater-footer-refresh.is-spinning svg { animation: updater-spin 900ms linear infinite; }
      .updater-footer-rail { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
      @media (hover: hover) { .updater-footer-rail:hover { background: var(--dsw-alias-interactive-bg-hover); } }
      .updater-footer-rail:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
      .updater-footer-badge { position: absolute; right: 1px; bottom: 1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 999px; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground); font-size: 9px; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
      .updater-footer-rail .updater-dot { position: absolute; left: 3px; top: 3px; }
      .updater-footer-rail .updater-spinner { position: absolute; right: 2px; top: 2px; }
      .updater-toast { position: fixed; top: 40px; left: 50%; z-index: 1100; display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(640px, calc(100vw - 48px)); padding: 12px 16px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-toast-label); font-size: 13.5px; line-height: 20px; box-shadow: var(--dsw-shadow-lv3); transform: translateX(-50%); pointer-events: none; animation: updater-toast-in 160ms ease-out, updater-toast-fade 1000ms ease var(--updater-toast-hold, 4000ms) forwards; }
      .updater-toast-icon { flex: none; display: inline-flex; color: var(--dsw-alias-state-warn-label); }
      .updater-toast[data-tone='success'] .updater-toast-icon { color: var(--dsw-alias-state-success-primary); }
      .updater-toast[data-tone='error'] .updater-toast-icon { color: var(--dsw-alias-state-error-primary); }
      .updater-toast-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .updater-toast-detail { font-size: 12px; line-height: 18px; opacity: 0.8; }
      .updater-toast-action { padding: 0; border: 0; background: none; color: var(--dsw-static-deepseek-400); font: inherit; cursor: pointer; pointer-events: auto; }
      @media (hover: hover) { .updater-toast-action:hover { opacity: 0.8; } }
      @keyframes updater-spin { to { transform: rotate(360deg); } }
      @keyframes updater-toast-in {
        from { opacity: 0; transform: translate(-50%, -6px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      @keyframes updater-toast-fade {
        to { opacity: 0; visibility: hidden; }
      }
      @media (prefers-reduced-motion: reduce) {
        .updater-tabs-indicator, .updater-tab { transition: none; }
        .updater-footer-refresh.is-spinning svg, .updater-spinner { animation: none; }
        .updater-toast { animation: updater-toast-fade 1000ms ease var(--updater-toast-hold, 4000ms) forwards; }
      }
      [data-platform='darwin'] .updater-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      @media (max-width: 767px) { .updater-panel { --updater-inset: 20px; } }
    `

    /**
     * Render the plugin's stylesheet once.
     * @returns {object} A style element.
     */
    function Styles() {
      return h('style', { 'data-plugin-updater': '' }, styles)
    }

    /**
     * Subscribe to the store.
     * @param {object} store Store handle.
     * @returns {object} The view.
     */
    function useSnapshot(store) {
      const [snapshot, setSnapshot] = useState(() => store.getSnapshot())
      useEffect(() => {
        const update = () => { setSnapshot(store.getSnapshot()) }
        update()
        return store.subscribe(update)
      }, [store])
      return snapshot
    }

    /**
     * The item glyph: an upward arrow in a circle, distinct from the refresh arrow.
     * @returns {object} An svg element.
     */
    function UpdaterIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }),
        h('path', { d: 'M8 11.2V5.4M5.6 7.6 8 5.2l2.4 2.4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      )
    }

    /**
     * The refresh glyph.
     * @returns {object} An svg element.
     */
    function RefreshIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.1h-2.5',
          fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }),
      )
    }

    /**
     * The success glyph.
     * @returns {object} An svg element.
     */
    function CheckIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.4, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }),
        h('path', { d: 'm5.2 8.1 1.9 1.9 3.7-3.9', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      )
    }

    /**
     * The warning glyph.
     * @returns {object} An svg element.
     */
    function WarnIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.4, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }),
        h('path', { d: 'M8 4.8v3.8', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
        h('circle', { cx: 8, cy: 11, r: 0.9, fill: 'currentColor' }),
      )
    }

    /**
     * A small progress ring.
     * @returns {object} An svg element.
     */
    function Spinner() {
      return h('svg', { className: 'updater-spinner', viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 5.4, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', opacity: '0.25' }),
        h('path', { d: 'M13.4 8A5.4 5.4 0 0 0 8 2.6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' }),
      )
    }

    /**
     * The sidebar footer entry.
     * @param {object} props Row props and the injected face.
     * @returns {object} The element.
     */
    function FooterEntry({ wide, store, openPanel }) {
      const view = useSnapshot(store)
      const count = view.total > 9 ? '9+' : view.total > 0 ? String(view.total) : ''
      const stale = view.current === false
      const failed = stale || view.rows.some((row) => row.state === 'failed-check')
      const failureLabel = stale ? t('entry.notCurrent') : t('entry.checkFailed')
      const running = view.checking || view.updating
      const label = count === '' ? t('entry.label') : t('entry.label') + ', ' + t('entry.countAria', { count })
      const railLabel = [label, failed ? failureLabel : '', running ? t('entry.progress') : '']
        .filter((part) => part !== '')
        .join(', ')

      if (!wide) {
        // The host renders this slot once with { wide }, and the panel may be
        // closed: the collapsed branch owns its stylesheet.
        return h(React.Fragment, null,
          h(Styles),
          h('button', {
            type: 'button',
            className: 'updater-footer-rail',
            'aria-label': railLabel,
            title: t('entry.label'),
            onClick: openPanel,
          },
            h(UpdaterIcon),
            count === '' ? null : h('span', { className: 'updater-footer-badge' }, count),
            failed ? h('span', { className: 'updater-dot', role: 'img', 'aria-label': failureLabel, title: failureLabel }) : null,
            running ? h(Spinner) : null,
          ),
        )
      }

      return h(React.Fragment, null,
        h(Styles),
        h('div', { className: 'updater-footer' },
          h('button', { type: 'button', className: 'updater-footer-main', onClick: openPanel, title: t('entry.label'), 'aria-label': label },
            h(UpdaterIcon),
            h('span', { className: 'updater-footer-label' }, t('entry.label')),
          ),
          h('span', { className: 'updater-footer-end' },
            failed ? h('span', { className: 'updater-dot', role: 'img', 'aria-label': failureLabel, title: failureLabel }) : null,
            count === '' ? null : h('span', { className: 'updater-footer-count', title: stale ? t('entry.notCurrent') : undefined }, count),
            h('button', {
              type: 'button',
              className: 'updater-footer-refresh' + (running ? ' is-spinning' : ''),
              'aria-label': running ? t('entry.progress') : t('entry.refresh'),
              title: running ? t('entry.progress') : t('entry.refresh'),
              disabled: view.checking || view.updating || view.busy,
              onClick: () => { void store.actions.refresh() },
            }, h(RefreshIcon)),
          ),
        ),
      )
    }

    /**
     * The panel header.
     * @param {object} props View.
     * @returns {object} The element.
     */
    function Header({ view }) {
      return h('header', { className: 'updater-head' },
        h('div', { className: 'updater-heading' },
          h('h2', { className: 'updater-title' }, t('entry.label')),
          h('p', { className: 'updater-summary' }, view.header.summary),
        ),
        view.header.lastChecked === undefined
          ? null
          : h('span', { className: 'updater-headmeta' }, view.header.lastChecked),
      )
    }

    /**
     * The two panel tabs.
     * @param {object} props Selected tab and its setter.
     * @returns {object} The element.
     */
    function Tabs({ tab, setTab }) {
      const refs = useRef({})
      const items = [
        { value: 'updates', label: t('tabs.updates') },
        { value: 'settings', label: t('tabs.settings') },
      ]
      const move = (event, value) => {
        let next
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = value === 'updates' ? 'settings' : 'updates'
        else if (event.key === 'Home') next = 'updates'
        else if (event.key === 'End') next = 'settings'
        else return
        event.preventDefault()
        setTab(next)
        const target = refs.current[next]
        if (target !== undefined && typeof target.focus === 'function') target.focus()
      }
      return h('div', { className: 'updater-tabs', role: 'tablist', 'aria-label': t('tabs.label') },
        h('span', { className: 'updater-tabs-indicator', 'data-tab': tab, 'aria-hidden': 'true' }),
        items.map((item) => h('button', {
          key: item.value,
          ref: (element) => { refs.current[item.value] = element },
          type: 'button',
          role: 'tab',
          id: 'updater-tab-' + item.value,
          'aria-controls': 'updater-panel-' + item.value,
          'aria-selected': tab === item.value,
          tabIndex: tab === item.value ? 0 : -1,
          className: 'updater-tab',
          onClick: () => { setTab(item.value) },
          onKeyDown: (event) => { move(event, item.value) },
        }, item.label)),
      )
    }

    /**
     * The action toolbar above the list.
     * @param {object} props View and store.
     * @returns {object} The element.
     */
    function Toolbar({ view, store }) {
      return h('div', { className: 'updater-toolbar' },
        h('span', { className: 'updater-spacer' }),
        h('button', {
          type: 'button',
          className: 'updater-button',
          disabled: view.checking || view.updating || view.busy,
          onClick: () => { void store.actions.refresh() },
        }, h(RefreshIcon), t('toolbar.checkNow')),
        view.updating
          ? h('button', {
            type: 'button',
            className: 'updater-button',
            onClick: () => { void store.actions.cancel() },
          }, t('actions.cancel'))
          : h('button', {
            type: 'button',
            className: 'updater-button updater-primary',
            disabled: !view.canUpdateAll,
            onClick: () => { void store.actions.updateAll() },
          }, t('actions.updateAll')),
      )
    }

    /**
     * Announcements for assistive technology.
     * @param {object} props Text.
     * @returns {object} The element.
     */
    function LiveRegion({ text }) {
      return h('div', { className: 'updater-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text)
    }

    /**
     * The pending-work tab.
     * @param {object} props View and store.
     * @returns {object} The element.
     */
    function UpdatesView({ view, store }) {
      return h('div', { className: 'updater-updates' },
        h(Toolbar, { view, store }),
        h('div', { className: 'updater-scroll' },
          view.error === undefined ? null : h('div', { className: 'updater-error', role: 'alert' }, view.error),
          view.restartRequired.length === 0 ? null : h('div', { className: 'updater-banner', role: 'status' }, t('restart.required')),
          view.rows.length === 0
            ? h(EmptyState, { view, store })
            : h('ul', { className: 'updater-list' }, view.rows.map((row) => h(Row, { key: row.name, row, store }))),
          h(IgnoredSection, { view, store }),
        ),
      )
    }

    /**
     * The empty state for the pending-work tab.
     * @param {object} props View and store.
     * @returns {object} The element.
     */
    function EmptyState({ view, store }) {
      const text = view.phase === 'loading'
        ? t('list.checking')
        : view.current === false
          ? t('list.checkFailed')
          : view.checkedAt === undefined ? t('list.unknown') : t('list.allCurrent')
      return h('div', { className: 'updater-empty' },
        h('p', null, text),
        h('button', {
          type: 'button',
          className: 'updater-button',
          disabled: view.checking || view.updating || view.busy,
          onClick: () => { void store.actions.refresh() },
        }, t('list.retry')),
      )
    }

    /**
     * One candidate row.
     * @param {object} props Row and store.
     * @returns {object} The element.
     */
    function Row({ row, store }) {
      const [notesOpen, setNotesOpen] = useState(false)
      const [outputOpen, setOutputOpen] = useState(false)
      const failed = row.state === 'failed'
        || (row.state === 'settled' && (row.outcome === 'failed' || row.outcome === 'restored'))
      useEffect(() => {
        if (failed) setOutputOpen(true)
      }, [failed])
      const status = statusOf(row, t)
      const actionable = row.state === 'idle' || row.state === 'failed-check'
      const version = versionLine(row, t)
      const actionLabel = row.action === 'reload'
        ? t('row.reload')
        : row.action === 'retry' ? t('row.retry') : t('row.update')
      const onAction = () => {
        if (row.action === 'retry') void store.actions.recheck(row.name)
        else void store.actions.updateOne(row.name)
      }
      const hasOutput = row.output !== undefined && (row.output.text !== '' || row.state === 'running')
      const showTrust = actionable && row.kind === 'git' && typeof row.repository === 'string'
        && row.trusted !== true && row.approval === undefined

      return h('li', { className: 'updater-row', 'data-state': row.state },
        h('div', { className: 'updater-row-head' },
          h('span', { className: 'updater-name' }, row.name),
          sourceLabel(row, t) === '' ? null : h('span', { className: 'updater-chip' }, sourceLabel(row, t)),
          version === '' ? null : h('span', { className: 'updater-version' }, version),
          row.state === 'failed-check'
            ? h('span', { className: 'updater-dot', role: 'img', 'aria-label': t('entry.checkFailed'), title: t('entry.checkFailed') })
            : null,
          h('span', { className: 'updater-spacer' }),
          status === undefined ? null : h('span', { className: 'updater-badge', 'data-tone': status.tone }, status.label),
          row.state === 'running' ? h(Spinner) : null,
          actionable && row.approval === undefined
            ? h('button', {
              type: 'button',
              className: 'updater-button updater-small',
              'aria-label': actionLabel + ' ' + row.name,
              onClick: onAction,
            }, actionLabel)
            : null,
          row.state === 'idle' && row.action === 'update' && row.approval === undefined
            ? h('button', {
              type: 'button',
              className: 'updater-link',
              'aria-label': t('row.ignore') + ' ' + row.name,
              onClick: () => { void store.actions.ignore(row) },
            }, t('row.ignore'))
            : null,
          showTrust
            ? h('button', {
              type: 'button',
              className: 'updater-link',
              title: row.repository,
              'aria-label': t('row.trust') + ' ' + row.name,
              onClick: () => { void store.actions.trust(row.name) },
            }, t('row.trust'))
            : null,
          (row.state === 'settled' || row.state === 'failed') && row.approval === undefined
            ? h('button', {
              type: 'button',
              className: 'updater-iconbutton',
              title: t('row.dismiss'),
              'aria-label': t('row.dismiss') + ' ' + row.name,
              onClick: () => { store.actions.dismiss(row.name) },
            }, '\u00d7')
            : null,
        ),
        row.kind === 'local' && row.state === 'idle' ? h('p', { className: 'updater-hint' }, t('row.reloadHint')) : null,
        row.state === 'failed-check' && row.reason !== undefined
          ? h('p', { className: 'updater-hint updater-error-text' }, row.reason)
          : row.reason === undefined ? null : h('p', { className: 'updater-hint' }, row.reason),
        row.specRestoreFailed === undefined ? null : h('p', { className: 'updater-warn' }, t('row.specRestoreFailed', { reason: row.specRestoreFailed })),
        (row.approved ?? []).length === 0
          ? null
          : h('p', { className: 'updater-hint' }, row.repository === undefined
            ? t('phase.approved') + ': ' + row.approved.join(', ')
            : t('phase.approved') + ' — ' + row.repository + ': ' + row.approved.join(', ')),
        row.approval === undefined ? null : h(ApprovalCard, { row, store }),
        row.notes === undefined ? null : h('div', { className: 'updater-detail' },
          h('button', {
            type: 'button',
            className: 'updater-link',
            'aria-expanded': notesOpen,
            onClick: () => { setNotesOpen(!notesOpen) },
          }, notesOpen ? t('row.hideNotes') : t('row.showNotes')),
          notesOpen
            ? (row.notes.available === true
              ? ((row.notes.items ?? []).length === 0
                ? h('p', { className: 'updater-hint' }, t('row.notesNone'))
                : h('ul', { className: 'updater-notes' }, row.notes.items.map((item) => h('li', { key: item.commit },
                  h('span', { className: 'updater-commit' }, String(item.commit).slice(0, 7)), ' ', item.subject,
                ))))
              : h('p', { className: 'updater-hint' }, t('row.notesUnavailable', { reason: row.notes.reason ?? 'unknown' })))
            : null,
        ),
        hasOutput ? h('div', { className: 'updater-detail' },
          h('button', {
            type: 'button',
            className: 'updater-link',
            'aria-expanded': outputOpen,
            onClick: () => { setOutputOpen(!outputOpen) },
          }, outputOpen ? t('row.hideOutput') : t('row.showOutput')),
          outputOpen ? h('pre', { className: 'updater-output' }, row.output.text) : null,
        ) : null,
      )
    }

    /**
     * The build approval request for one row.
     * @param {object} props Row and store.
     * @returns {object} The element.
     */
    function ApprovalCard({ row, store }) {
      const approval = row.approval
      const disabled = row.state === 'running' || row.state === 'queued'
      return h('div', { className: 'updater-approval', role: 'group', 'aria-label': t('approval.title') },
        h('p', { className: 'updater-approval-title' }, t('approval.title')),
        h('p', { className: 'updater-hint' }, t('approval.body', { name: row.name, repository: approval.repository })),
        h('p', { className: 'updater-approval-label' }, t('approval.keys')),
        h('ul', { className: 'updater-keys' }, approval.keys.map((key) => h('li', { key }, h('code', null, key)))),
        h('div', { className: 'updater-actions' },
          h('button', {
            type: 'button',
            className: 'updater-button updater-primary',
            disabled,
            onClick: () => { void store.actions.decideBuild(row.name, 'allow') },
          }, t('approval.allow')),
          h('button', {
            type: 'button',
            className: 'updater-button',
            disabled,
            onClick: () => { void store.actions.decideBuild(row.name, 'always-allow') },
          }, t('approval.always', { repository: approval.repository })),
          h('button', {
            type: 'button',
            className: 'updater-link',
            disabled,
            onClick: () => { void store.actions.decideBuild(row.name, 'decline') },
          }, t('approval.decline')),
        ),
      )
    }

    /**
     * The ignored updates section.
     * @param {object} props View and store.
     * @returns {object|null} The element.
     */
    function IgnoredSection({ view, store }) {
      const [open, setOpen] = useState(false)
      const entries = (view.ignoredUpdates ?? []).length > 0
        ? view.ignoredUpdates.map((entry) => ({ name: entry.name, identity: String(entry.identity) }))
        : (view.ignored ?? []).map((entry) => ({
          name: entry.name,
          identity: String(entry.identity?.commit ?? entry.identity?.available ?? ''),
        }))
      if (entries.length === 0) return null
      const unignore = (name) => {
        const kept = (view.ignoredUpdates ?? []).filter((entry) => entry.name !== name)
        void store.actions.saveConfig({ ignoredUpdates: kept })
      }
      return h('section', { className: 'updater-ignored' },
        h('button', {
          type: 'button',
          className: 'updater-link',
          'aria-expanded': open,
          onClick: () => { setOpen(!open) },
        }, t('list.ignoredTitle') + ' \u00b7 ' + t('list.ignoredCount', { count: entries.length })
          + ' \u00b7 ' + (open ? t('list.hideIgnored') : t('list.reviewIgnored'))),
        open
          ? h('ul', { className: 'updater-ignored-list' }, entries.map((entry) => h('li', { key: entry.name, className: 'updater-ignored-row' },
            h('span', null, entry.name + ' (' + entry.identity.slice(0, 7) + ')'),
            h('span', { className: 'updater-spacer' }),
            h('button', { type: 'button', className: 'updater-link', onClick: () => { unignore(entry.name) } }, t('settings.ignoredClear')),
          )))
          : null,
      )
    }

    /**
     * The settings tab.
     * @param {object} props View and store.
     * @returns {object} The element.
     */
    function SettingsView({ view, store }) {
      const [draft, setDraft] = useState('')
      const [problem, setProblem] = useState('')
      const trusted = view.trustedRepositories ?? []
      const ignored = view.ignoredUpdates ?? []
      const cache = view.cache

      const add = () => {
        const value = draft.trim()
        if (value === '') return
        if (/[*?]/.test(value) || value.split('/').filter(Boolean).length < 2) {
          setProblem(t('settings.trustedInvalid'))
          return
        }
        setProblem('')
        setDraft('')
        void store.actions.saveConfig({ trustedRepositories: [...trusted, value] })
      }
      const remove = (repository) => {
        void store.actions.saveConfig({ trustedRepositories: trusted.filter((entry) => entry !== repository) })
      }
      const unignore = (name) => {
        void store.actions.saveConfig({ ignoredUpdates: ignored.filter((entry) => entry.name !== name) })
      }

      return h('div', { className: 'updater-scroll updater-settings' },
        h('section', { className: 'updater-card' },
          h('h3', { className: 'updater-card-title' }, t('settings.trustedTitle')),
          h('p', { className: 'updater-card-desc' }, t('settings.trustedDescription')),
          trusted.length === 0
            ? h('p', { className: 'updater-hint' }, t('settings.trustedEmpty'))
            : h('ul', { className: 'updater-trusted' }, trusted.map((repository) => h('li', { key: repository, className: 'updater-trusted-row' },
              h('span', null, repository),
              h('span', { className: 'updater-spacer' }),
              h('button', { type: 'button', className: 'updater-link', onClick: () => { remove(repository) } }, t('settings.remove')),
            ))),
          h('div', { className: 'updater-field' },
            h('input', {
              className: 'updater-input',
              value: draft,
              placeholder: t('settings.trustedPlaceholder'),
              'aria-label': t('settings.trustedAdd'),
              onChange: (event) => { setDraft(event.target.value) },
              onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); add() } },
            }),
            h('button', { type: 'button', className: 'updater-button', onClick: add }, t('settings.trustedAdd')),
          ),
          problem === '' ? null : h('p', { className: 'updater-hint updater-error-text' }, problem),
        ),
        h('section', { className: 'updater-card' },
          h('h3', { className: 'updater-card-title' }, t('settings.ignoredTitle')),
          ignored.length === 0
            ? h('p', { className: 'updater-hint' }, t('settings.ignoredEmpty'))
            : h('ul', { className: 'updater-trusted' }, ignored.map((entry) => h('li', { key: entry.name, className: 'updater-trusted-row' },
              h('span', null, entry.name + ' (' + String(entry.identity).slice(0, 7) + ')'),
              h('span', { className: 'updater-spacer' }),
              h('button', { type: 'button', className: 'updater-link', onClick: () => { unignore(entry.name) } }, t('settings.ignoredClear')),
            ))),
        ),
        h('section', { className: 'updater-card' },
          h('h3', { className: 'updater-card-title' }, t('settings.cacheTitle')),
          h('p', { className: 'updater-card-desc' }, t('settings.cacheDescription')),
          cache === undefined
            ? null
            : h('p', { className: 'updater-hint' }, t('settings.cacheUsage', {
              used: Math.round(cache.bytes / 1048576) + ' MB',
              limit: Math.round(cache.limitBytes / 1048576) + ' MB',
              count: cache.repositories,
            })),
          h('button', { type: 'button', className: 'updater-button', onClick: () => { void store.actions.clearCache() } }, t('settings.cacheClear')),
        ),
      )
    }

    /**
     * The main panel.
     * @param {object} props Panel props and the injected face.
     * @returns {object} The element.
     */
    function UpdaterPanel({ store }) {
      const view = useSnapshot(store)
      const [tab, setTab] = useState('updates')
      return h('div', { className: 'updater-panel' },
        h(Styles),
        h('div', { className: 'updater-page' },
          h(Header, { view }),
          view.header.notCurrent === undefined
            ? null
            : h('div', { className: 'updater-notice', role: 'status' }, view.header.notCurrent),
          h(Tabs, { tab, setTab }),
          h(LiveRegion, { text: view.announcement }),
          h('div', {
            className: 'updater-tabpanel',
            role: 'tabpanel',
            id: 'updater-panel-updates',
            'aria-labelledby': 'updater-tab-updates',
            hidden: tab !== 'updates',
          }, h(UpdatesView, { view, store })),
          h('div', {
            className: 'updater-tabpanel',
            role: 'tabpanel',
            id: 'updater-panel-settings',
            'aria-labelledby': 'updater-tab-settings',
            hidden: tab !== 'settings',
          }, h(SettingsView, { view, store })),
        ),
      )
    }

    /**
     * The completion notice, shown outside the panel.
     * @param {object} props Store face.
     * @returns {object|null} The element.
     */
    function UpdaterNotice({ store }) {
      const view = useSnapshot(store)
      const notice = view.notice
      useEffect(() => {
        if (notice === undefined) return undefined
        const hold = notice.tone === 'error' ? TOAST_FAILURE_MS : TOAST_MS
        // The stylesheet fades for one second after the hold; unmount after it.
        const timer = setTimeout(() => { store.actions.dismissNotice() }, hold + 1000)
        return () => { clearTimeout(timer) }
      }, [notice?.id, store])
      if (notice === undefined) return null
      return h(React.Fragment, null,
        h(Styles),
        h('div', {
          className: 'updater-toast',
          role: 'alert',
          'data-tone': notice.tone,
          style: { '--updater-toast-hold': (notice.tone === 'error' ? TOAST_FAILURE_MS : TOAST_MS) + 'ms' },
        },
          h('span', { className: 'updater-toast-icon', 'aria-hidden': 'true' },
            notice.tone === 'success' ? h(CheckIcon) : h(WarnIcon)),
          h('div', { className: 'updater-toast-text' },
            h('span', null, notice.text),
            notice.detail === undefined ? null : h('span', { className: 'updater-toast-detail' }, notice.detail),
            notice.restart === true ? h('span', { className: 'updater-toast-detail' }, t('restart.required')) : null,
          ),
          h('button', {
            type: 'button',
            className: 'updater-toast-action',
            onClick: () => { store.actions.openPanel(); store.actions.dismissNotice() },
          }, t('summary.viewDetails')),
          h('button', {
            type: 'button',
            className: 'updater-toast-action',
            onClick: () => { store.actions.dismissNotice() },
          }, t('notice.dismiss')),
        ),
      )
    }

    /**
     * Mount the browser half.
     * @param {object} ctx Client context.
     * @returns {Promise<() => Promise<void>>} A disposer.
     */
    async function apply(ctx) {
      // The namespace this plugin calls is mounted here, so it must not be a
      // declared dependency: Cordis parks a fiber until every injected service
      // resolves, and the service only appears after this line runs.
      const unmount = await ctx.remote.$mount(remote)
      const consumer = ctx.inject(['remote.pluginUpdater'], (scoped) => {
        const store = createStore({ remote: scoped.remote, layout: scoped.layout, translate: t })
        const disposers = [() => { store.dispose() }]
        disposers.push(scoped.slots.inject('sidebar.footer.action', () => scoped.slots.register({
          name: 'sidebar.footer.action',
          id: PANEL_ID,
          order: 0,
          inject: () => ({ store, openPanel: () => { store.actions.openPanel() } }),
        }, FooterEntry)))
        disposers.push(scoped.slots.inject('main', () => scoped.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ store }),
        }, UpdaterPanel)))
        // The overlay carries the completion notice when the panel is not open:
        // without it a finished update would report nothing at all.
        disposers.push(scoped.slots.inject('shell.overlay', () => scoped.slots.register({
          name: 'shell.overlay',
          id: 'plugin-updater-notice',
          inject: () => ({ store }),
        }, UpdaterNotice)))
        return () => { for (const dispose of disposers.reverse()) dispose() }
      })
      try {
        await consumer
      } catch (error) {
        try { await consumer.dispose() } finally { await unmount() }
        throw error
      }
      return async () => {
        await consumer.dispose()
        await unmount()
      }
    }

    function h(type, props, ...children) {
      return React.createElement(type, props, ...children)
    }

    return {
      inject: ['slots', 'remote', 'layout'],
      apply,
      FooterEntry,
      rowsFromSnapshot,
      rowsOf,
      mergeRow,
      summaryNoticeOf,
      createStore,
      statusOf,
      headerOf,
      stepLabel,
      outcomeLabel,
      versionLine,
      formatClock,
    }

  },
})
