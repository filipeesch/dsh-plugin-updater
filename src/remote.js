/**
 * A hand-written Remote contribution.
 *
 * This package ships plain ESM and installs from a git spec, so nothing
 * generates a Typert contribution for it. The descriptor factory below is
 * written out here rather than imported, because the protocol version resolved
 * in a profile does not export it: an installed third-party plugin that faces
 * the same problem carries its own copy for the same reason.
 *
 * The factory turns a method specification into the descriptors the host's
 * gateway consumes: an `id`, a namespace and method split from the endpoint, one
 * parameter entry per argument with its wire name and codec, a result codec, and
 * a named-input parser that also projects JSON Schema for tooling.
 * @module dsh-plugin-updater/remote
 */

import { z } from 'zod'

/** The package identity carried by every descriptor. */
export const PACKAGE_NAME = 'dsh-plugin-updater'

/** The Cordis service key the descriptors address. */
export const SERVICE_NAME = 'pluginUpdater'

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

/** The current attempt inside a run record. */
const RunCurrent = z.object({
  name: z.string(),
  step: z.string(),
  requestId: z.string(),
})

/** One settled candidate recorded while the queue is still running. */
const RunResult = z.object({
  name: z.string(),
  outcome: z.string(),
  reason: z.string().optional(),
})

/** The observable state of one update or queue. */
const Run = z.object({
  startedAt: z.number(),
  current: RunCurrent.optional(),
  results: z.array(RunResult),
})

/** A build approval the user still has to decide. */
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
  specRestoreFailed: z.string().optional(),
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

/** The result of deciding a build approval. */
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
    'pluginUpdater/saveConfig': {
      ...base, parameters: [parameter('request', ConfigWriteRequest, 'ConfigWriteRequest')], result: codec('Snapshot', () => Snapshot),
    },
    'pluginUpdater/clearCache': {
      ...base, parameters: [parameter('request', EmptyRequest, 'EmptyRequest')], result: codec('Snapshot', () => Snapshot),
    },
  },
}

/** The client-facing face. */
export const remote = new RemoteInfo(spec, z)

/** The host-facing face, registered with `ctx.typert.register`. */
export const host = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  get invocations() { return remote.descriptors },
  model: { services: [], events: [], objects: [] },
}

export default remote
