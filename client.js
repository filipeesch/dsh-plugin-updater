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
        proposedRepositories: z.array(z.string()).optional(),
        cache: z.object({ bytes: z.number(), repositories: z.number(), limitBytes: z.number() }).optional(),
        trustedRepositories: z.array(z.string()).optional(),
        ignoredUpdates: z.array(z.object({ name: z.string(), identity: z.string() })).optional(),
        running: z.boolean().optional(),
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
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** The panel id shared by the footer entry and the panel it opens. */
    const PANEL_ID = 'plugin-updater'

    const strings = {
      'entry.label': 'Plugin Updater',
      'entry.countAria': '{{count}} plugins need attention',
      'entry.refresh': 'Check for plugin updates',
      'entry.checkFailed': 'A plugin could not be checked',
      'entry.notCurrent': 'Not checked since the last failure',
      'tabs.updates': 'Updates',
      'tabs.settings': 'Settings',
      'list.allCurrent': 'Everything is up to date.',
      'list.lastChecked': 'Last checked at {{time}}',
      'list.unknown': 'No successful check yet.',
      'list.checking': 'Checking…',
      'list.retry': 'Check again',
      'list.ignoredTitle': 'Ignored updates',
      'list.ignoredCount': '{{count}} ignored',
      'row.update': 'Update',
      'row.reload': 'Reload',
      'row.retry': 'Try again',
      'row.showNotes': 'Show changes',
      'row.hideNotes': 'Hide changes',
      'row.notesNone': 'No changes were found.',
      'row.notesUnavailable': 'Changes could not be loaded: {{reason}}',
      'row.showOutput': 'Show output',
      'row.hideOutput': 'Hide output',
      'row.sourceRegistry': 'npm',
      'row.sourceGit': 'GitHub',
      'row.sourceLocal': 'Local',
      'row.notChecked': 'Not checked',
      'row.ignore': 'Ignore',
      'row.specRestoreFailed': 'The saved version could not be reset, so this plugin may stop reporting updates: {{reason}}',
      'phase.running': 'Working',
      'phase.updated': 'Updated',
      'phase.reloaded': 'Reloaded',
      'phase.failed': 'Failed',
      'phase.cancelled': 'Cancelled',
      'phase.restored': 'Restored',
      'phase.needsApproval': 'Needs approval',
      'phase.approved': 'Build script approved',
      'restart.required': 'Restart DeepSeek Harness to load the updated plugins.',
      'summary.updated': '{{count}} updated',
      'summary.reloaded': '{{count}} reloaded',
      'summary.needsApproval': '{{count}} needs approval',
      'summary.failed': '{{count}} failed',
      'summary.restored': '{{count}} restored',
      'summary.skippedIgnored': '{{count}} ignored skipped',
      'summary.specRestoreFailed': '{{count}} plugin(s) may stop reporting updates because the saved version could not be reset',
      'summary.viewDetails': 'View details',
      'actions.updateAll': 'Update all',
      'actions.cancel': 'Cancel',
      'settings.trustedTitle': 'Trusted repositories',
      'settings.trustedDescription': 'Build scripts are approved automatically only for these repositories. Every other repository asks first.',
      'settings.trustedEmpty': 'No trusted repositories. Every build script asks first.',
      'settings.trustedAdd': 'Add repository',
      'settings.trustedPlaceholder': 'github.com/owner/repo',
      'settings.trustedInvalid': 'Enter one repository as owner/repo or host/owner/repo. Trust is per repository, not per account.',
      'settings.remove': 'Remove',
      'settings.ignoredTitle': 'Ignored updates',
      'settings.ignoredEmpty': 'No ignored updates.',
      'settings.ignoredClear': 'Stop ignoring',
      'settings.cacheTitle': 'Change cache',
      'settings.cacheUsage': '{{used}} of {{limit}} used by {{count}} repositories.',
      'settings.cacheClear': 'Clear cache',
      'error.generic': 'Something went wrong: {{reason}}',
      'onboarding.title': 'Trust your plugin repositories',
      'onboarding.body': 'Approving a build script runs code from that repository. Trust only the repositories you installed on purpose. Nothing is trusted until you confirm.',
      'onboarding.confirm': 'Trust these repositories',
      'onboarding.later': 'Decide later',
    }

    /**
     * Resolve one string, filling `{{name}}` placeholders.
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
   * The rows the panel shows for a snapshot.
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
    const pinned = new Map((state.specRestoreFailed ?? []).map((entry) => [entry.name, entry.reason]))
    const warn = (name) => (pinned.has(name) ? { specRestoreFailed: pinned.get(name) } : {})
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
    const counts = { updated: 0, reloaded: 0, restored: 0, needsApproval: 0, failed: 0 }
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
    if (skipped > 0) parts.push(translate('summary.skippedIgnored', { count: skipped }))
    if (pinned > 0) parts.push(translate('summary.specRestoreFailed', { count: pinned }))
    return parts.length === 0 ? undefined : parts.join(', ')
  }

    const styles = `
      .updater-footer { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 0 4px; box-sizing: border-box; }
      .updater-footer-main { display: flex; align-items: center; gap: var(--dsh-sidebar-label-gap, 8px); flex: 1; min-width: 0; min-height: 32px; padding: 5px 4px; border: 0; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; line-height: 22px; text-align: left; cursor: pointer; }
      .updater-footer-main:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .updater-footer-main:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
      .updater-footer-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .updater-footer-end { display: flex; align-items: center; gap: 4px; flex: none; }
      .updater-footer-count { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-caption); min-width: 14px; text-align: right; }
      .updater-footer-pill { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-state-warn-secondary, rgba(255,170,0,.16)); color: var(--dsw-alias-state-warn-primary, #b26a00); white-space: nowrap; }
      .updater-footer-refresh { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-caption); cursor: pointer; }
      .updater-footer-refresh:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .updater-footer-refresh.is-spinning svg { animation: updater-spin 900ms linear infinite; }
      @keyframes updater-spin { to { transform: rotate(360deg); } }
      .updater-footer-rail { position: relative; width: 36px; height: 36px; justify-content: center; padding: 0; border: 0; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
      .updater-footer-badge { position: absolute; right: 1px; bottom: 1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 999px; background: var(--dsw-alias-state-business-primary, #2563eb); color: #fff; font-size: 9px; line-height: 13px; text-align: center; font-variant-numeric: tabular-nums; }
      .updater-footer-failed { position: absolute; left: 1px; top: 1px; width: 5px; height: 5px; border-radius: 999px; background: var(--dsw-alias-state-warn-primary, #b26a00); }
      .updater-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
      .updater-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px 0; flex: none; }
      .updater-title { font-size: 15px; font-weight: 600; margin: 0; }
      .updater-tabs { display: flex; gap: 4px; margin-left: auto; }
      .updater-tab { padding: 5px 10px; border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-caption); font: inherit; font-size: 13px; cursor: pointer; }
      .updater-tab[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .updater-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 18px 18px; display: flex; flex-direction: column; gap: 8px; }
      .updater-row { border: 1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.08)); border-radius: var(--dsw-radius-md, 8px); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
      .updater-row-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .updater-name { font-weight: 600; font-size: 13px; }
      .updater-source { font-size: 11px; color: var(--dsw-alias-label-caption); }
      .updater-version { font-size: 12px; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
      .updater-spacer { flex: 1; }
      .updater-button { padding: 4px 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.12)); border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
      .updater-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .updater-button-primary { background: var(--dsw-alias-state-business-primary, #2563eb); border-color: transparent; color: #fff; }
      .updater-button:disabled { opacity: .5; cursor: default; }
      .updater-link { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-state-business-primary, #2563eb); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
      .updater-notes { max-height: 220px; overflow-y: auto; margin: 0; padding: 6px 0 0; list-style: none; font-size: 12px; color: var(--dsw-alias-label-caption); display: flex; flex-direction: column; gap: 3px; }
      .updater-commit { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; opacity: .75; }
      .updater-foot { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-top: 1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.08)); flex: none; font-size: 12px; color: var(--dsw-alias-label-caption); }
      .updater-empty { padding: 28px 0; text-align: center; color: var(--dsw-alias-label-caption); font-size: 13px; }
      .updater-notice { padding: 8px 12px; border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-state-warn-secondary, rgba(255,170,0,.14)); color: var(--dsw-alias-state-warn-primary, #8a5300); font-size: 12px; }
      .updater-field { display: flex; gap: 6px; align-items: center; }
      .updater-input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.14)); border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
      .updater-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
      .updater-list-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
      .updater-section-title { font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
      .updater-hint { font-size: 11px; color: var(--dsw-alias-label-caption); margin: 0; }
      .updater-proposal { margin: 10px 18px 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.12)); border-radius: var(--dsw-radius-md, 8px); display: flex; flex-direction: column; gap: 6px; flex: none; }
      .updater-proposal-title { font-size: 13px; font-weight: 600; }
      .updater-output { max-height: 160px; overflow: auto; margin: 4px 0 0; padding: 8px; border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-surface-sunken, rgba(0,0,0,.05)); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
      .updater-toast { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-surface-overlay, #1f2430); color: var(--dsw-alias-label-inverse, #fff); font-size: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.24); pointer-events: auto; z-index: 40; }
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
     * @returns {object} The snapshot.
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
     * Create the client store.
     * @param {object} ctx Client context.
     * @returns {object} Store handle.
     */
    function createStore(ctx) {
      const listeners = new Set()
      let disposed = false
      let snapshot = {
        phase: 'idle', rows: [], ignored: [], total: 0,
        trustedRepositories: [], ignoredUpdates: [], restartRequired: [], error: undefined,
        notice: undefined,
      }

      const publish = (next) => {
        if (disposed) return
        snapshot = next
        for (const listener of listeners) listener()
      }

      const unwrap = (result) => {
        if (result !== null && typeof result === 'object' && 'ok' in result) {
          if (result.ok === true) return result.value
          throw new Error(result.error?.message ?? 'the host refused the call')
        }
        return result
      }

      const call = async (name, request) => {
        try {
          const fn = ctx.remote.pluginUpdater[name]
          return unwrap(await fn(request ?? {}))
        } catch (error) {
          publish({ ...snapshot, phase: 'idle', error: error instanceof Error ? error.message : String(error) })
          return undefined
        }
      }

      const rowsOf = rowsFromSnapshot

      const adopt = (state) => publish({
        phase: 'idle',
        rows: rowsOf(state),
        ignored: state.ignored ?? [],
        total: state.total ?? 0,
        checkedAt: state.checkedAt,
        current: state.current,
        lastFailure: state.lastFailure,
        running: false,
        restartRequired: state.restartRequired ?? [],
        specRestoreFailed: state.specRestoreFailed ?? [],
        cache: state.cache,
        trustedRepositories: state.trustedRepositories ?? [],
        ignoredUpdates: state.ignoredUpdates ?? [],
        proposedRepositories: state.proposedRepositories ?? [],
        error: undefined,
      })


      const summaryNotice = (results, skipped = 0) => summaryNoticeOf(results, skipped, t)

      const markRow = (name, state) => snapshot.rows.map((row) => (row.name === name ? { ...row, state } : row))

      const actions = {
        async load() {
          publish({ ...snapshot, phase: 'loading' })
          const state = await call('snapshot')
          if (state !== undefined) adopt(state)
        },
        async refresh() {
          publish({ ...snapshot, phase: 'checking' })
          const state = await call('refresh')
          if (state !== undefined) adopt(state)
        },
        async updateOne(name) {
          publish({ ...snapshot, phase: 'updating', rows: markRow(name, 'running') })
          const result = await call('updateOne', { name })
          const outcome = result?.outcome ?? 'failed'
          publish({
            ...snapshot, phase: 'idle',
            rows: snapshot.rows.map((row) => (row.name === name
              ? { ...row, state: outcome, output: result?.output, reason: result?.reason ?? row.reason, needsApproval: result?.needsApproval, specRestoreFailed: result?.specRestoreFailed }
              : row)),
          })
          await actions.load()
        },
        async cancel() {
          await call('cancel')
        },
        async updateAll() {
          publish({ ...snapshot, phase: 'updating', running: true, notice: undefined })
          const result = await call('updateAll')
          publish({ ...snapshot, phase: 'idle', running: false, summary: result?.results, notice: summaryNotice(result?.results, result?.skippedIgnored) })
          await actions.load()
        },
        dismissNotice() {
          publish({ ...snapshot, notice: undefined })
        },
        async ignore(row) {
          // A git update is identified by its commit, a registry one by its
          // version: several commits can share a version, and ignoring by
          // version would hide a later, different commit.
          const identity = row.kind === 'git' ? row.commit : row.available
          if (identity === undefined) return
          const kept = (snapshot.ignoredUpdates ?? []).filter((entry) => entry.name !== row.name)
          await actions.saveConfig({ ignoredUpdates: [...kept, { name: row.name, identity: String(identity) }] })
        },
        async saveConfig(patch) {
          const state = await call('saveConfig', patch)
          if (state !== undefined) adopt(state)
        },
        async clearCache() {
          const state = await call('clearCache')
          if (state !== undefined) adopt(state)
        },
        openPanel() {
          ctx.layout.selectPanel(PANEL_ID)
          void actions.load()
        },
      }

      const subscription = ctx.remote.$on?.('plugin-manager/changed', () => { void actions.refresh() })

      return {
        actions,
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        dispose() {
          disposed = true
          listeners.clear()
          subscription?.()
        },
      }
    }

    /**
     * The sidebar footer entry.
     * @param {object} props Row props and the injected face.
     * @returns {object} The element.
     */
    function FooterEntry({ wide, store, openPanel }) {
      const snapshot = useSnapshot(store)
      const total = snapshot.total ?? 0
      const count = total > 9 ? '9+' : total > 0 ? String(total) : ''
      const failed = (snapshot.rows ?? []).some((row) => row.state === 'failed-check')
      const spinning = snapshot.phase === 'checking'
      const stale = snapshot.current === false

      if (!wide) {
        return h('button', {
          type: 'button',
          className: 'updater-footer-rail',
          'aria-label': count === '' ? t('entry.label') : `${t('entry.label')}, ${t('entry.countAria', { count })}`,
          title: t('entry.label'),
          onClick: openPanel,
        },
          h(Icon),
          count === '' ? null : h('span', { className: 'updater-footer-badge' }, count),
          failed ? h('span', { className: 'updater-footer-failed' }) : null,
        )
      }

      return h(React.Fragment, null,
        h(Styles),
        h('div', { className: 'updater-footer' },
          h('button', { type: 'button', className: 'updater-footer-main', onClick: openPanel, title: t('entry.label') },
            h(Icon),
            h('span', { className: 'updater-footer-label' }, t('entry.label')),
          ),
          h('span', { className: 'updater-footer-end' },
            failed ? h('span', { className: 'updater-footer-pill', title: t('entry.checkFailed') }, t('entry.checkFailed')) : null,
            stale ? h('span', { className: 'updater-footer-pill', title: t('entry.notCurrent') }, '?') : null,
            count === '' ? null : h('span', { className: 'updater-footer-count' }, count),
            h('button', {
              type: 'button',
              className: `updater-footer-refresh${spinning ? ' is-spinning' : ''}`,
              'aria-label': t('entry.refresh'),
              title: t('entry.refresh'),
              disabled: spinning,
              onClick: () => { void store.actions.refresh() },
            }, h(RefreshIcon)),
          ),
        ),
      )
    }

    /**
     * The main panel.
     * @param {object} props Panel props and the injected face.
     * @returns {object} The element.
     */
    function UpdaterPanel({ store }) {
      const snapshot = useSnapshot(store)
      const [tab, setTab] = useState('updates')
      const rows = snapshot.rows ?? []

      return h('div', { className: 'updater-panel' },
        h(Styles),
        h('div', { className: 'updater-head' },
          h('h2', { className: 'updater-title' }, t('entry.label')),
          h('div', { className: 'updater-tabs', role: 'tablist' },
            h('button', {
              type: 'button', role: 'tab', className: 'updater-tab',
              'aria-selected': tab === 'updates', onClick: () => { setTab('updates') },
            }, t('tabs.updates')),
            h('button', {
              type: 'button', role: 'tab', className: 'updater-tab',
              'aria-selected': tab === 'settings', onClick: () => { setTab('settings') },
            }, t('tabs.settings')),
          ),
        ),
        (snapshot.proposedRepositories ?? []).length === 0 ? null : h(TrustProposal, { snapshot, store }),
        h('div', { className: 'updater-body' },
          snapshot.error === undefined ? null : h('div', { className: 'updater-notice' }, t('error.generic', { reason: snapshot.error })),
          tab === 'updates' ? h(UpdatesTab, { snapshot, store }) : h(SettingsTab, { snapshot, store }),
        ),
        (snapshot.restartRequired ?? []).length === 0 ? null : h('div', { className: 'updater-foot' },
          h('span', { className: 'updater-notice' }, t('restart.required')),
        ),
        tab !== 'updates' || rows.length === 0 ? null : h('div', { className: 'updater-foot' },
          h('span', null, snapshot.checkedAt === undefined ? '' : t('list.lastChecked', { time: new Date(snapshot.checkedAt).toLocaleTimeString() })),
          h('span', { className: 'updater-spacer' }),
          snapshot.phase === 'updating'
            ? h('button', {
              type: 'button', className: 'updater-button',
              onClick: () => { void store.actions.cancel() },
            }, t('actions.cancel'))
            : h('button', {
              type: 'button', className: 'updater-button updater-button-primary',
              onClick: () => { void store.actions.updateAll() },
            }, t('actions.updateAll')),
        ),
      )
    }

    /**
     * The pending-work tab.
     * @param {object} props Snapshot and injected face.
     * @returns {object} The element.
     */
    function UpdatesTab({ snapshot, store }) {
      const rows = snapshot.rows ?? []
      const ignored = snapshot.ignored ?? []
      if (snapshot.phase === 'loading') return h('div', { className: 'updater-empty' }, t('list.checking'))
      if (rows.length === 0) {
        return h('div', { className: 'updater-empty' },
          h('div', null, snapshot.checkedAt === undefined ? t('list.unknown') : t('list.allCurrent')),
          h('div', { style: { marginTop: 8 } },
            h('button', { type: 'button', className: 'updater-button', disabled: snapshot.phase === 'checking', onClick: () => { void store.actions.refresh() } }, t('list.retry')),
          ),
        )
      }
      return h(React.Fragment, null,
        rows.map((row) => h(Row, { key: row.name, row, store, disabled: snapshot.phase === 'updating' })),
        ignored.length === 0 ? null : h('div', { className: 'updater-hint' }, t('list.ignoredCount', { count: ignored.length })),
      )
    }

    /**
     * One candidate row.
     * @param {object} props Row, store, and disabled flag.
     * @returns {object} The element.
     */
    function Row({ row, store, disabled }) {
      const [notesOpen, setNotesOpen] = useState(false)
      const [outputOpen, setOutputOpen] = useState(row.state === 'failed' || row.state === 'restored')
      const source = row.kind === 'registry' ? t('row.sourceRegistry') : row.kind === 'git' ? t('row.sourceGit') : t('row.sourceLocal')
      const label = row.action === 'reload' ? t('row.reload') : row.action === 'retry' ? t('row.retry') : t('row.update')
      const running = row.state === 'running' || disabled
      const version = row.available === undefined
        ? (row.installed === undefined ? '' : row.installed)
        : `${row.installed ?? '?'} \u2192 ${row.available}`
      const commits = row.commits === undefined || row.available !== undefined ? '' : `${row.commits} commit${row.commits === 1 ? '' : 's'}`

      return h('div', { className: 'updater-row' },
        h('div', { className: 'updater-row-head' },
          h('span', { className: 'updater-name' }, row.name),
          h('span', { className: 'updater-source' }, source),
          version === '' ? null : h('span', { className: 'updater-version' }, version),
          commits === '' ? null : h('span', { className: 'updater-version' }, commits),
          row.state === 'failed-check' ? h('span', { className: 'updater-footer-pill' }, t('row.notChecked')) : null,
          h('span', { className: 'updater-spacer' }),
          row.state === 'running' ? h('span', { className: 'updater-version' }, t('phase.running')) : null,
          row.state === 'updated' ? h('span', { className: 'updater-version' }, t('phase.updated')) : null,
          row.state === 'reloaded' ? h('span', { className: 'updater-version' }, t('phase.reloaded')) : null,
          row.state === 'restored' ? h('span', { className: 'updater-version' }, t('phase.restored')) : null,
          row.state === 'needsApproval' ? h('span', { className: 'updater-version' }, t('phase.needsApproval')) : null,
          h('button', {
            type: 'button', className: 'updater-button', disabled: running,
            onClick: () => { void store.actions.updateOne(row.name) },
          }, label),
          row.action === 'retry' ? null : h('button', {
            type: 'button', className: 'updater-link', disabled: running,
            onClick: () => { void store.actions.ignore(row) },
          }, t('row.ignore')),
        ),
        row.reason === undefined ? null : h('div', { className: 'updater-hint' }, row.reason),
        row.specRestoreFailed === undefined ? null : h('div', { className: 'updater-notice' },
          t('row.specRestoreFailed', { reason: row.specRestoreFailed }),
        ),
        (row.needsApproval ?? []).length === 0 ? null : h('div', { className: 'updater-hint' },
          t('phase.needsApproval'), ': ', row.needsApproval.join(', '),
        ),
        row.output === undefined ? null : h('div', { className: 'updater-hint' },
          h('button', {
            type: 'button', className: 'updater-link',
            onClick: () => { setOutputOpen(!outputOpen) },
          }, outputOpen ? t('row.hideOutput') : t('row.showOutput')),
          outputOpen ? h('pre', { className: 'updater-output' }, row.output.text) : null,
        ),
        row.notes === undefined ? null : h('div', { className: 'updater-hint' },
          h('button', { type: 'button', className: 'updater-link', onClick: () => { setNotesOpen(!notesOpen) } },
            notesOpen ? t('row.hideNotes') : t('row.showNotes')),
          notesOpen
            ? row.notes.available === true
              ? h('ul', { className: 'updater-notes' }, (row.notes.items ?? []).map((item) => h('li', { key: item.commit },
                h('span', { className: 'updater-commit' }, String(item.commit).slice(0, 7)), ' ', item.subject,
              )))
              : h('div', null, t('row.notesUnavailable', { reason: row.notes.reason ?? 'unknown' }))
            : null,
        ),
      )
    }

    /**
     * The settings tab.
     * @param {object} props Snapshot and injected face.
     * @returns {object} The element.
     */
    function SettingsTab({ snapshot, store }) {
      const [draft, setDraft] = useState('')
      const [problem, setProblem] = useState('')
      const trusted = snapshot.trustedRepositories ?? []
      const ignored = snapshot.ignoredUpdates ?? []
      const cache = snapshot.cache

      const add = async () => {
        const value = draft.trim()
        if (value === '') return
        if (/[*?]/.test(value) || value.split('/').filter(Boolean).length < 2) {
          setProblem(t('settings.trustedInvalid'))
          return
        }
        setProblem('')
        setDraft('')
        await store.actions.saveConfig({ trustedRepositories: [...trusted, value] })
      }

      const remove = async (repository) => {
        await store.actions.saveConfig({ trustedRepositories: trusted.filter((entry) => entry !== repository) })
      }

      const unignore = async (name) => {
        await store.actions.saveConfig({ ignoredUpdates: ignored.filter((entry) => entry.name !== name) })
      }

      return h(React.Fragment, null,
        h('div', { className: 'updater-section-title' }, t('settings.trustedTitle')),
        h('p', { className: 'updater-hint' }, t('settings.trustedDescription')),
        trusted.length === 0
          ? h('p', { className: 'updater-hint' }, t('settings.trustedEmpty'))
          : h('ul', { className: 'updater-list' }, trusted.map((repository) => h('li', { key: repository, className: 'updater-list-item' },
            h('span', null, repository),
            h('span', { className: 'updater-spacer' }),
            h('button', { type: 'button', className: 'updater-link', onClick: () => { void remove(repository) } }, t('settings.remove')),
          ))),
        h('div', { className: 'updater-field' },
          h('input', {
            className: 'updater-input', value: draft, placeholder: t('settings.trustedPlaceholder'),
            onChange: (event) => { setDraft(event.target.value) },
            onKeyDown: (event) => { if (event.key === 'Enter') void add() },
          }),
          h('button', { type: 'button', className: 'updater-button', onClick: () => { void add() } }, t('settings.trustedAdd')),
        ),
        problem === '' ? null : h('p', { className: 'updater-hint' }, problem),

        h('div', { className: 'updater-section-title' }, t('settings.ignoredTitle')),
        ignored.length === 0
          ? h('p', { className: 'updater-hint' }, t('settings.ignoredEmpty'))
          : h('ul', { className: 'updater-list' }, ignored.map((entry) => h('li', { key: entry.name, className: 'updater-list-item' },
            h('span', null, `${entry.name} (${String(entry.identity).slice(0, 7)})`),
            h('span', { className: 'updater-spacer' }),
            h('button', { type: 'button', className: 'updater-link', onClick: () => { void unignore(entry.name) } }, t('settings.ignoredClear')),
          ))),

        h('div', { className: 'updater-section-title' }, t('settings.cacheTitle')),
        cache === undefined
          ? null
          : h('p', { className: 'updater-hint' }, t('settings.cacheUsage', {
            used: `${Math.round(cache.bytes / 1048576)} MB`,
            limit: `${Math.round(cache.limitBytes / 1048576)} MB`,
            count: cache.repositories,
          })),
        h('button', { type: 'button', className: 'updater-button', onClick: () => { void store.actions.clearCache() } }, t('settings.cacheClear')),
      )
    }

    /**
     * The first-use proposal: the repositories of the plugins already installed
     * from git, offered for confirmation. Nothing is trusted until the user
     * accepts, and an entry removed here is not trusted.
     * @param {object} props Snapshot and store.
     * @returns {object|null} The element, or null when not applicable.
     */
    function TrustProposal({ snapshot, store }) {
      const proposed = snapshot.proposedRepositories ?? []
      const [kept, setKept] = useState(() => proposed.slice())
      const signature = proposed.join('\n')
      useEffect(() => { setKept(proposed.slice()) }, [signature])
      if (proposed.length === 0) return null

      const toggle = (repository) => {
        setKept((current) => current.includes(repository)
          ? current.filter((entry) => entry !== repository)
          : [...current, repository])
      }

      return h('div', { className: 'updater-proposal', role: 'region', 'aria-label': t('onboarding.title') },
        h('div', { className: 'updater-proposal-title' }, t('onboarding.title')),
        h('p', { className: 'updater-hint' }, t('onboarding.body')),
        h('ul', { className: 'updater-list' }, proposed.map((repository) => h('li', { key: repository, className: 'updater-list-item' },
          h('label', { className: 'updater-list-item' },
            h('input', {
              type: 'checkbox',
              checked: kept.includes(repository),
              onChange: () => { toggle(repository) },
            }),
            h('span', null, repository),
          ),
        ))),
        h('div', { className: 'updater-field' },
          h('button', {
            type: 'button',
            className: 'updater-button updater-button-primary',
            onClick: () => { void store.actions.saveConfig({ trustedRepositories: kept }) },
          }, t('onboarding.confirm')),
          h('button', {
            type: 'button',
            className: 'updater-button',
            onClick: () => { void store.actions.saveConfig({ trustedRepositories: [] }) },
          }, t('onboarding.later')),
        ),
      )
    }

    /**
     * The batch result, shown outside the panel.
     * @param {object} props Store face.
     * @returns {object|null} The element, or null when there is nothing to report.
     */
    function UpdaterNotice({ store }) {
      const snapshot = useSnapshot(store)
      if (snapshot.notice === undefined) return null
      return h(React.Fragment, null,
        h(Styles),
        h('div', { className: 'updater-toast', role: 'status' },
          h('span', null, snapshot.notice),
          h('button', {
            type: 'button',
            className: 'updater-link',
            onClick: () => { store.actions.openPanel(); store.actions.dismissNotice() },
          }, t('summary.viewDetails')),
          h('button', {
            type: 'button',
            className: 'updater-link',
            'aria-label': t('actions.cancel'),
            onClick: () => { store.actions.dismissNotice() },
          }, '×'),
        ),
      )
    }

    /**
     * The item glyph.
     * @returns {object} An svg element.
     */
    function Icon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }),
        h('path', { d: 'M8 4.6v3.9l2.6 1.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' }),
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
        const store = createStore(scoped)
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
        // The overlay carries the batch result when the panel is not open:
        // without it a finished queue would report nothing at all.
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

    return { inject: ['slots', 'locale', 'remote', 'layout'], apply, rowsFromSnapshot, summaryNoticeOf, t }
  },
})
