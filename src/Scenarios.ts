import { Cause, Context, Data, Effect, Layer, Option, Schema } from "effect"
import { Model, Stock, Variable } from "./Model.js"
import { ScenarioId, ModelId } from "./Types.js"
import {
  ParallelSimulationOptions,
  ParallelSimulationResult,
  ParallelSimulationTarget,
  SimState,
  simulateEager,
  simulateFinal,
  simulateParallel,
} from "./Simulation.js"
import { Solver } from "./Solver.js"
import { UnitManager } from "./Units.js"
import { SolverError } from "./Errors.js"

/**
 * Scenario definition describing a set of parameter overrides applied to a base model.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioDefinition extends Schema.Class<ScenarioDefinition>("ScenarioDefinition")({
  id: ScenarioId,
  name: Schema.NonEmptyTrimmedString,
  baseModelId: ModelId,
  overrides: Schema.Record({
    key: Schema.String,
    value: Schema.Number,
  }),
  description: Schema.optional(Schema.String),
}) {}

/**
 * Summary information for a scenario run.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioSummary extends Schema.Class<ScenarioSummary>("ScenarioSummary")({
  scenarioId: ScenarioId,
  name: Schema.NonEmptyTrimmedString,
  finalTime: Schema.Number,
  finalStocks: Schema.Record({ key: Schema.String, value: Schema.Number }),
  finalVariables: Schema.Record({ key: Schema.String, value: Schema.Number }),
  deltaStocks: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Number }),
  ),
  deltaVariables: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Number }),
  ),
}) {}

/**
 * Comparison payload between a baseline run and scenario variants.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioComparison extends Schema.Class<ScenarioComparison>(
  "ScenarioComparison",
)({
  baseline: ScenarioSummary,
  scenarios: Schema.Array(ScenarioSummary),
}) {}

/**
 * Percentile entry generated from Monte Carlo sampling.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloPercentile extends Schema.Class<MonteCarloPercentile>(
  "MonteCarloPercentile",
)({
  percentile: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(1)),
  value: Schema.Number,
}) {}

/**
 * Aggregated statistics for a single metric across Monte Carlo samples.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloMetricSummary extends Schema.Class<MonteCarloMetricSummary>(
  "MonteCarloMetricSummary",
)({
  name: Schema.NonEmptyTrimmedString,
  mean: Schema.Number,
  variance: Schema.Number,
  min: Schema.Number,
  max: Schema.Number,
  percentiles: Schema.Array(MonteCarloPercentile),
}) {}

/**
 * Result payload returned by Monte Carlo runs.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloResult extends Schema.Class<MonteCarloResult>("MonteCarloResult")({
  iterations: Schema.Number.pipe(Schema.greaterThan(0)),
  metrics: Schema.Array(MonteCarloMetricSummary),
}) {}

/**
 * Result returned from executing a scenario.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export interface ScenarioRun {
  readonly definition: ScenarioDefinition
  readonly model: Model
  readonly final: SimState
  readonly states?: ReadonlyArray<SimState>
}

/**
 * Options controlling scenario execution.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export interface ScenarioRunOptions {
  readonly collectStates?: boolean
  readonly parallelism?: number | "unbounded"
}

/**
 * Input supplied to a Monte Carlo parameter sampler.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export interface MonteCarloSampleContext {
  readonly iteration: number
  readonly baseline: number
  readonly random: () => number
}

/**
 * Sampler invoked to draw a value for a parameter override.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export type MonteCarloSampler = (context: MonteCarloSampleContext) => number

/**
 * Parameter override definition used for Monte Carlo sampling.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export interface MonteCarloParameter {
  readonly name: string
  readonly sampler: MonteCarloSampler
}

/**
 * Options describing a Monte Carlo experiment.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export type MonteCarloOptions = ScenarioRunOptions & {
  readonly iterations: number
  readonly parameters: ReadonlyArray<MonteCarloParameter>
  readonly metrics: ReadonlyArray<string>
  readonly seed?: number
  readonly percentiles?: ReadonlyArray<number>
  readonly concurrency?: number | "unbounded"
}

type OverrideTarget =
  | { readonly kind: "stock"; readonly stock: Stock }
  | { readonly kind: "constant"; readonly variable: Variable }

const findOverrideTarget = (
  model: Model,
  name: string,
): Option.Option<OverrideTarget> => {
  for (const stock of model.stocks) {
    if (stock.name === name) {
      return Option.some({ kind: "stock", stock })
    }
  }
  for (const variable of model.variables) {
    if (variable.name === name && variable.type === "constant") {
      return Option.some({ kind: "constant", variable })
    }
  }
  return Option.none()
}

/**
 * Raised when scenario overrides reference unknown parameters.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioOverrideNotFoundError extends Data.TaggedError(
  "ScenarioOverrideNotFoundError",
)<{
  readonly scenarioId?: ScenarioId
  readonly targets: ReadonlyArray<string>
}> {
  override get message(): string {
    const prefix = this.scenarioId ? `Scenario ${this.scenarioId} ` : "Scenario"
    return `${prefix}references unknown overrides: ${this.targets.join(", ")}`
  }
}

/**
 * Raised when an override targets an unsupported parameter (e.g., auxiliary variable).
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioUnsupportedOverrideError extends Data.TaggedError(
  "ScenarioUnsupportedOverrideError",
)<{
  readonly scenarioId?: ScenarioId
  readonly target: string
  readonly reason: string
}> {
  override get message(): string {
    const prefix = this.scenarioId ? `Scenario ${this.scenarioId}` : "Scenario"
    return `${prefix} cannot override "${this.target}": ${this.reason}`
  }
}

/**
 * Raised when a requested metric is not present in the simulation output.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioMetricNotFoundError extends Data.TaggedError(
  "ScenarioMetricNotFoundError",
)<{
  readonly name: string
}> {
  override get message(): string {
    return `Metric "${this.name}" was not found in stocks or variables`
  }
}

/**
 * Raised when Monte Carlo configuration is invalid.
 */
export class MonteCarloConfigurationError extends Data.TaggedError(
  "MonteCarloConfigurationError",
)<{
  readonly reason: string
}> {
  override get message(): string {
    return `Invalid Monte Carlo configuration: ${this.reason}`
  }
}

/**
 * Raised when a scenario references a different base model than the one provided.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioModelMismatchError extends Data.TaggedError("ScenarioModelMismatchError")<{
  readonly scenarioId: ScenarioId
  readonly expected: ModelId
  readonly actual: ModelId
}> {
  override get message(): string {
    return `Scenario ${this.scenarioId} expects model ${this.expected} but received ${this.actual}`
  }
}

/**
 * Union type capturing scenario-related failures.
 *
 * @category Errors
 * @since 0.1.0
 */
export type ScenarioError =
  | ScenarioOverrideNotFoundError
  | ScenarioUnsupportedOverrideError
  | ScenarioMetricNotFoundError
  | ScenarioModelMismatchError
  | MonteCarloConfigurationError

type ScenarioRuntimeError = ScenarioError | SolverError | Cause.NoSuchElementException

const applyOverrides = (
  definition: ScenarioDefinition,
  model: Model,
): Effect.Effect<Model, ScenarioError> =>
  Effect.sync(() => {
    if (definition.baseModelId !== model.id) {
      throw new ScenarioModelMismatchError({
        scenarioId: definition.id,
        expected: definition.baseModelId,
        actual: model.id,
      })
    }
    const overrides = definition.overrides
    if (Object.keys(overrides).length === 0) {
      return model
    }

    const unmatched = new Set(Object.keys(overrides))

    const stocks = model.stocks.map((stock) => {
      const override = overrides[stock.name]
      if (override === undefined) {
        return stock
      }
      unmatched.delete(stock.name)
      return new Stock({
        id: stock.id,
        name: stock.name,
        initialValue: override,
        units: stock.units,
        description: stock.description,
      })
    })

    const variables = model.variables.map((variable) => {
      const override = overrides[variable.name]
      if (override === undefined) {
        return variable
      }
      unmatched.delete(variable.name)
      if (variable.type !== "constant") {
        throw new ScenarioUnsupportedOverrideError({
          scenarioId: definition.id,
          target: variable.name,
          reason: "only constant variables can be overridden",
        })
      }
      return new Variable({
        id: variable.id,
        name: variable.name,
        equation: variable.equation,
        type: "constant",
        value: override,
      })
    })

    if (unmatched.size > 0) {
      throw new ScenarioOverrideNotFoundError({
        scenarioId: definition.id,
        targets: Array.from(unmatched),
      })
    }

    return new Model({
      id: model.id,
      name: model.name,
      stocks,
      flows: model.flows,
      variables,
      timeConfig: model.timeConfig,
    })
  })

const summariseFinalState = (
  definition: ScenarioDefinition,
  model: Model,
  final: SimState,
  baseline?: { readonly state: SimState; readonly model: Model },
): ScenarioSummary => {
  const finalStocks: Record<string, number> = Object.create(null)
  for (const stock of model.stocks) {
    finalStocks[stock.name] = final.stocks[stock.id] ?? 0
  }

  const finalVariables: Record<string, number> = Object.create(null)
  for (const variable of model.variables) {
    finalVariables[variable.name] = final.variables[variable.id] ?? variable.value ?? 0
  }

  let deltaStocks: Record<string, number> | undefined
  let deltaVariables: Record<string, number> | undefined

  if (baseline) {
    const baselineStocksByName: Record<string, number> = Object.create(null)
    for (const stock of baseline.model.stocks) {
      baselineStocksByName[stock.name] = baseline.state.stocks[stock.id] ?? 0
    }

    const baselineVariablesByName: Record<string, number> = Object.create(null)
    for (const variable of baseline.model.variables) {
      baselineVariablesByName[variable.name] =
        baseline.state.variables[variable.id] ?? variable.value ?? 0
    }

    const stockDeltaMap: Record<string, number> = Object.create(null)
    for (const name of Object.keys(finalStocks)) {
      const baselineValue = baselineStocksByName[name] ?? 0
      const finalValue = finalStocks[name] ?? 0
      stockDeltaMap[name] = finalValue - baselineValue
    }

    const variableDeltaMap: Record<string, number> = Object.create(null)
    for (const name of Object.keys(finalVariables)) {
      const baselineValue = baselineVariablesByName[name] ?? 0
      const finalValue = finalVariables[name] ?? 0
      variableDeltaMap[name] = finalValue - baselineValue
    }

    deltaStocks = stockDeltaMap
    deltaVariables = variableDeltaMap
  }

  return new ScenarioSummary({
    scenarioId: definition.id,
    name: definition.name,
    finalTime: final.time,
    finalStocks,
    finalVariables,
    deltaStocks,
    deltaVariables,
  })
}

const getMetric = (
  model: Model,
  state: SimState,
  name: string,
): Effect.Effect<number, ScenarioMetricNotFoundError> => {
  const directStock = state.stocks[name]
  if (directStock !== undefined) {
    return Effect.succeed(directStock)
  }
  const stock = model.stocks.find((candidate) => candidate.name === name)
  if (stock) {
    const value = state.stocks[stock.id]
    if (value !== undefined) {
      return Effect.succeed(value)
    }
  }

  const directVariable = state.variables[name]
  if (directVariable !== undefined) {
    return Effect.succeed(directVariable)
  }
  const variable = model.variables.find((candidate) => candidate.name === name)
  if (variable) {
    const value = state.variables[variable.id]
    if (value !== undefined) {
      return Effect.succeed(value)
    }
  }

  return Effect.fail(new ScenarioMetricNotFoundError({ name }))
}

const locateBaselineValue = (
  model: Model,
  parameter: string,
): Effect.Effect<number, ScenarioUnsupportedOverrideError | ScenarioOverrideNotFoundError> =>
  Effect.sync(() => {
    const target = findOverrideTarget(model, parameter)
    if (Option.isNone(target)) {
      throw new ScenarioOverrideNotFoundError({
        targets: [parameter],
      })
    }
    if (target.value.kind === "stock") {
      return target.value.stock.initialValue
    }
    const variable = target.value.variable
    if (variable.value === undefined) {
      throw new ScenarioUnsupportedOverrideError({
        target: parameter,
        reason: "constant variable is missing a value",
      })
    }
    return variable.value
  })

const findStateAtTime = (states: ReadonlyArray<SimState>, time: number): SimState => {
  for (const state of states) {
    if (state.time >= time) {
      return state
    }
  }
  const fallback = states.at(-1) ?? states[0]
  if (!fallback) {
    throw new ScenarioMetricNotFoundError({ name: `state@${time}` })
  }
  return fallback
}

const evaluateOverrides = (
  scenarioService: ScenarioServiceHandle,
  model: Model,
  objective: Objective,
  overrides: Record<string, number>,
  scenarioOptions: ScenarioRunOptions | undefined,
): Effect.Effect<number, OptimizationError, Solver | UnitManager> =>
  Effect.gen(function* () {
    const definition = new ScenarioDefinition({
      id: anonymousScenarioId,
      name: "Optimization",
      baseModelId: model.id,
      overrides,
    })

    const run = yield* scenarioService.run(model, definition, {
      collectStates: true,
      ...scenarioOptions,
    })

    const states = run.states ?? (yield* simulateEager(run.model))
    const stateAtTime = findStateAtTime(states, objective.atTime)
    return yield* getMetric(run.model, stateAtTime, objective.target)
  })

const gridStrategy: OptimizationStrategy = {
  name: "grid",
  optimize: (context) =>
    Effect.gen(function* () {
      const { model, objective, constraints, scenarioService, options } = context
      if (constraints.length === 0) {
        const value = yield* evaluateOverrides(scenarioService, model, objective, {}, options.scenarioOptions)
        return { bestParameters: {}, bestValue: value, iterations: 1 }
      }

      const steps = Math.max(2, options.stepsPerParameter ?? 5)
      const valuesByParameter = constraints.map((constraint) => {
        const span = constraint.max - constraint.min
        const values: Array<number> = []
        if (steps === 1 || Math.abs(span) < Number.EPSILON) {
          values.push(constraint.min)
        } else {
          const stepSize = span / (steps - 1)
          for (let i = 0; i < steps; i++) {
            values.push(constraint.min + stepSize * i)
          }
        }
        return { parameter: constraint.parameter, values }
      })

      const combinations: Array<Record<string, number>> = []

      const build = (index: number, current: Record<string, number>) => {
        if (index >= valuesByParameter.length) {
          combinations.push({ ...current })
          return
        }
        const entry = valuesByParameter[index]
        if (!entry) {
          return
        }
        for (const value of entry.values) {
          current[entry.parameter] = value
          build(index + 1, current)
        }
      }

      build(0, {})

      let bestValue = Number.NEGATIVE_INFINITY
      let bestParameters: Record<string, number> = {}
      let iterations = 0

      for (const overrides of combinations) {
        iterations += 1
        const value = yield* evaluateOverrides(
          scenarioService,
          model,
          objective,
          overrides,
          options.scenarioOptions,
        )

        const isBetter =
          objective.direction === "maximize" ? value > bestValue : value < bestValue

        if (isBetter || bestValue === Number.NEGATIVE_INFINITY) {
          bestValue = value
          bestParameters = { ...overrides }
        }
      }

      if (combinations.length === 0) {
        const value = yield* evaluateOverrides(
          scenarioService,
          model,
          objective,
          {},
          options.scenarioOptions,
        )
        return { bestParameters: {}, bestValue: value, iterations: iterations + 1 }
      }

      return { bestParameters, bestValue, iterations }
    }),
}

const makeRandomStrategy = (defaultIterations: number): OptimizationStrategy => ({
  name: "random",
  optimize: (context) =>
    Effect.gen(function* () {
      const { model, objective, constraints, scenarioService, options } = context
      const iterations = Math.max(1, options.iterations ?? defaultIterations)

      const evaluate = (overrides: Record<string, number>) =>
        evaluateOverrides(scenarioService, model, objective, overrides, options.scenarioOptions)

      let bestParameters: Record<string, number> = {}
      let bestValue = yield* evaluateOverrides(
        scenarioService,
        model,
        objective,
        {},
        options.scenarioOptions,
      )
      let evaluated = 1

      if (constraints.length === 0) {
        return { bestParameters, bestValue, iterations: evaluated }
      }

      for (let i = 0; i < iterations; i++) {
        const overrides: Record<string, number> = {}
        for (const constraint of constraints) {
          const min = constraint.min
          const max = constraint.max
          const value = Math.abs(max - min) < Number.EPSILON
            ? min
            : min + Math.random() * (max - min)
          overrides[constraint.parameter] = value
        }

        const value = yield* evaluate(overrides)
        evaluated += 1

        const isBetter =
          objective.direction === "maximize" ? value > bestValue : value < bestValue

        if (isBetter) {
          bestValue = value
          bestParameters = { ...overrides }
        }
      }

      return { bestParameters, bestValue, iterations: evaluated }
    }),
})

const resolveStrategy = (options: OptimizationOptions): OptimizationStrategy => {
  const strategyOption = options.strategy
  if (!strategyOption) {
    return gridStrategy
  }
  if (typeof strategyOption === "string") {
    if (strategyOption === "grid") {
      return gridStrategy
    }
    if (strategyOption === "random") {
      return makeRandomStrategy(Math.max(1, options.iterations ?? 50))
    }
  }
  return strategyOption
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000"
const decodeScenarioId = Schema.decodeSync(ScenarioId)

const anonymousScenarioId = decodeScenarioId(ZERO_UUID)

const DEFAULT_MONTE_CARLO_PERCENTILES = Object.freeze([0.5, 0.9, 0.95])

/**
 * Creates a deterministic pseudo-random number generator using a 32-bit mulberry sequence.
 */
const createDeterministicRng = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

/**
 * Computes an interpolated percentile using the given sorted samples.
 */
const percentileOf = (sorted: ReadonlyArray<number>, percentile: number): number => {
  if (sorted.length === 0) {
    return 0
  }
  const clamped = Math.min(1, Math.max(0, percentile))
  const index = (sorted.length - 1) * clamped
  const lower = Math.floor(index)
  const upper = Math.min(sorted.length - 1, Math.ceil(index))
  if (lower === upper) {
    return sorted[lower]!
  }
  const lowerValue = sorted[lower]!
  const upperValue = sorted[upper]!
  const weight = index - lower
  return lowerValue + (upperValue - lowerValue) * weight
}

/**
 * Builds a Monte Carlo metric summary from collected samples.
 */
const summariseMetric = (
  name: string,
  values: ReadonlyArray<number>,
  percentiles: ReadonlyArray<number>,
): MonteCarloMetricSummary => {
  const count = values.length
  if (count === 0) {
    return new MonteCarloMetricSummary({
      name,
      mean: 0,
      variance: 0,
      min: 0,
      max: 0,
      percentiles: [],
    })
  }

  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const value of values) {
    sum += value
    if (value < min) min = value
    if (value > max) max = value
  }

  const mean = sum / count
  let varianceAccumulator = 0
  for (const value of values) {
    const diff = value - mean
    varianceAccumulator += diff * diff
  }
  const variance = count > 1 ? varianceAccumulator / (count - 1) : 0

  const sorted = [...values].sort((a, b) => a - b)
  const entries = percentiles.map((percentile) =>
    new MonteCarloPercentile({ percentile, value: percentileOf(sorted, percentile) }),
  )

  return new MonteCarloMetricSummary({
    name,
    mean,
    variance,
    min,
    max,
    percentiles: entries,
  })
}

/**
 * Runtime implementation of the ScenarioService interface.
 */
const makeScenarioService = (): ScenarioServiceHandle => {
  const service: ScenarioServiceHandle = {
    branch: (model: Model, definition: ScenarioDefinition) =>
      applyOverrides(definition, model).pipe(
        Effect.map((overriddenModel) => ({
          definition,
          model: overriddenModel,
        })),
      ),

    run: (model: Model, definition: ScenarioDefinition, options: ScenarioRunOptions = {}) =>
      Effect.gen(function* () {
        const result = yield* applyOverrides(definition, model)
        if (options.collectStates) {
          const states = yield* simulateEager(result)
          const final = states.at(-1) ?? (yield* simulateFinal(result))
          return { definition, model: result, final, states }
        }
        const final = yield* simulateFinal(result)
        return { definition, model: result, final }
      }),

    compare: (model: Model, definitions: ReadonlyArray<ScenarioDefinition>, options: ScenarioRunOptions = {}) =>
      Effect.gen(function* () {
        const baselineDefinition = new ScenarioDefinition({
          id: anonymousScenarioId,
          name: "Baseline",
          baseModelId: model.id,
          overrides: {},
        })

        const definitionsWithBaseline: ReadonlyArray<ScenarioDefinition> = [
          baselineDefinition,
          ...definitions,
        ]

        const prepared = yield* Effect.forEach(definitionsWithBaseline, (definition) =>
          applyOverrides(definition, model).pipe(
            Effect.map((overridden) => ({ definition, model: overridden })),
          ),
        )

        const targets: ReadonlyArray<ParallelSimulationTarget> = prepared.map(({ definition, model }) => ({
          id: definition.id,
          model,
          ...(options.collectStates !== undefined ? { collectStates: options.collectStates } : {}),
        }))

        const parallelOptions: ParallelSimulationOptions = {
          ...(options.collectStates !== undefined ? { collectStates: options.collectStates } : {}),
          ...(options.parallelism !== undefined ? { parallelism: options.parallelism } : {}),
        }

        const results = yield* simulateParallel(targets, parallelOptions)

        const baselineResult: ParallelSimulationResult = results[0]!
        const baselineModel = prepared[0]!.model

        const baselineRun: ScenarioRun = {
          definition: baselineDefinition,
          model: baselineModel,
          final: baselineResult.final,
          ...(baselineResult.states ? { states: baselineResult.states } : {}),
        }

        const scenarioRuns: Array<ScenarioRun> = []
        for (let index = 1; index < results.length; index += 1) {
          const result = results[index]
          const entry = prepared[index]
          if (!result || !entry) {
            continue
          }
          scenarioRuns.push({
            definition: entry.definition,
            model: entry.model,
            final: result.final,
            ...(result.states ? { states: result.states } : {}),
          })
        }

        const baselineSummary = summariseFinalState(
          baselineDefinition,
          baselineRun.model,
          baselineRun.final,
        )
        const scenarios = scenarioRuns.map((run) =>
          summariseFinalState(run.definition, run.model, run.final, {
            state: baselineRun.final,
            model: baselineRun.model,
          }),
        )

        return new ScenarioComparison({ baseline: baselineSummary, scenarios })
      }),

    monteCarlo: (model: Model, baseDefinition: ScenarioDefinition, config: MonteCarloOptions) =>
      Effect.gen(function* () {
        if (baseDefinition.baseModelId !== model.id) {
          throw new ScenarioModelMismatchError({
            scenarioId: baseDefinition.id,
            expected: baseDefinition.baseModelId,
            actual: model.id,
          })
        }

        const iterations = Math.floor(config.iterations)
        if (!Number.isFinite(iterations) || iterations <= 0) {
          throw new MonteCarloConfigurationError({ reason: "iterations must be a positive integer" })
        }

        if (config.metrics.length === 0) {
          throw new MonteCarloConfigurationError({ reason: "at least one metric must be requested" })
        }

        const parameters = config.parameters
        const scenarioOptions: ScenarioRunOptions = {
          ...(config.collectStates !== undefined ? { collectStates: config.collectStates } : {}),
          ...(config.parallelism !== undefined ? { parallelism: config.parallelism } : {}),
        }

        const percentiles = (config.percentiles && config.percentiles.length > 0
          ? config.percentiles
          : DEFAULT_MONTE_CARLO_PERCENTILES)
          .map((value) => Math.min(1, Math.max(0, value)))
          .sort((a, b) => a - b)

        const baselineValues = new Map<string, number>()
        for (const parameter of parameters) {
          const baseline = yield* locateBaselineValue(model, parameter.name)
          baselineValues.set(parameter.name, baseline)
        }

        const rng = createDeterministicRng(config.seed ?? 0x9e3779b9)
        const metricSamples = new Map<string, Array<number>>()
        for (const metric of config.metrics) {
          metricSamples.set(metric, [])
        }

        const iterationIndices = Array.from({ length: iterations }, (_, index) => index)

        yield* Effect.forEach(
          iterationIndices,
          (iteration) =>
            Effect.gen(function* () {
              const overrides: Record<string, number> = { ...baseDefinition.overrides }

              for (const parameter of parameters) {
                const baseline = baselineValues.get(parameter.name)
                if (baseline === undefined) {
                  continue
                }
                const value = parameter.sampler({
                  iteration: iteration + 1,
                  baseline,
                  random: rng,
                })
                overrides[parameter.name] = value
              }

              const definition = new ScenarioDefinition({
                id: anonymousScenarioId,
                name: `${baseDefinition.name}#${iteration + 1}`,
                baseModelId: baseDefinition.baseModelId,
                overrides,
              })

              const run = yield* service.run(model, definition, scenarioOptions)

              for (const metric of config.metrics) {
                const value = yield* getMetric(run.model, run.final, metric)
                metricSamples.get(metric)?.push(value)
              }
            }),
          { concurrency: config.concurrency ?? "unbounded" },
        )

        const summaries = Array.from(metricSamples.entries()).map(([name, values]) =>
          summariseMetric(name, values, percentiles),
        )

        return new MonteCarloResult({
          iterations,
          metrics: summaries,
        })
      }),
  }

  return service
}

export interface ScenarioServiceHandle {
  readonly branch: (
    model: Model,
    definition: ScenarioDefinition,
  ) => Effect.Effect<{ readonly definition: ScenarioDefinition; readonly model: Model }, ScenarioError>
  readonly run: (
    model: Model,
    definition: ScenarioDefinition,
    options?: ScenarioRunOptions,
  ) => Effect.Effect<ScenarioRun, ScenarioRuntimeError, Solver | UnitManager>
  readonly compare: (
    model: Model,
    definitions: ReadonlyArray<ScenarioDefinition>,
    options?: ScenarioRunOptions,
  ) => Effect.Effect<ScenarioComparison, ScenarioRuntimeError, Solver | UnitManager>
  readonly monteCarlo: (
    model: Model,
    baseDefinition: ScenarioDefinition,
    config: MonteCarloOptions,
  ) => Effect.Effect<MonteCarloResult, ScenarioRuntimeError, Solver | UnitManager>
}

/**
 * Scenario service tag for dependency injection.
 *
 * @category Services
 * @since 0.1.0
 */
export class ScenarioService extends Context.Tag(
  "@org/effect-system-dynamics/ScenarioService",
)<ScenarioService, ScenarioServiceHandle>() {
  /**
   * Default layer providing the in-memory scenario service implementation.
   */
  static readonly layer = Layer.succeed(this, makeScenarioService())
}

/**
 * Sensitivity analysis result capturing the impact of a parameter tweak.
 *
 * @category Sensitivity
 * @since 0.1.0
 */
export class SensitivityResult extends Schema.Class<SensitivityResult>("SensitivityResult")({
  parameter: Schema.String,
  impact: Schema.Number,
  direction: Schema.Literal("positive", "negative", "neutral"),
  confidence: Schema.Number,
}) {}

/**
 * Sensitivity analysis specific errors.
 *
 * @category Errors
 * @since 0.1.0
 */
export type SensitivityError = ScenarioRuntimeError

const makeSensitivityService = (scenarioService: ScenarioServiceHandle) => ({
  analyze: (
    model: Model,
    target: string,
    parameters: ReadonlyArray<string>,
    variationPercent: number,
    options: ScenarioRunOptions = {},
  ): Effect.Effect<ReadonlyArray<SensitivityResult>, SensitivityError, Solver | UnitManager> =>
    Effect.gen(function* () {
      const baselineDefinition = new ScenarioDefinition({
        id: anonymousScenarioId,
        name: "Baseline",
        baseModelId: model.id,
        overrides: {},
      })

      const baselineRun = yield* scenarioService.run(model, baselineDefinition, options)
      const baselineMetric = yield* getMetric(model, baselineRun.final, target)

      const results = yield* Effect.forEach(parameters, (parameter) =>
        Effect.gen(function* () {
          const baseValue = yield* locateBaselineValue(model, parameter)
          const overrideValue = baseValue * (1 + variationPercent / 100)

          const definition = new ScenarioDefinition({
            id: anonymousScenarioId,
            name: `Variation: ${parameter}`,
            baseModelId: model.id,
            overrides: { [parameter]: overrideValue },
          })

          const run = yield* scenarioService.run(model, definition, options)
          const metric = yield* getMetric(run.model, run.final, target)

          const difference = metric - baselineMetric
          const impact = baselineMetric === 0 ? difference : (difference / baselineMetric) * 100
          const direction = impact === 0
            ? "neutral"
            : impact > 0
            ? "positive"
            : "negative"

          return new SensitivityResult({
            parameter,
            impact,
            direction,
            confidence: 1,
          })
        }),
        { concurrency: "unbounded" },
      )

      return results.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    }),
})

export interface SensitivityServiceHandle {
  readonly analyze: (
    model: Model,
    target: string,
    parameters: ReadonlyArray<string>,
    variationPercent: number,
    options?: ScenarioRunOptions,
  ) => Effect.Effect<ReadonlyArray<SensitivityResult>, SensitivityError, Solver | UnitManager>
}

/**
 * Sensitivity service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export class SensitivityService extends Context.Tag(
  "@org/effect-system-dynamics/SensitivityService",
)<SensitivityService, SensitivityServiceHandle>() {
  static layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const scenarioService = yield* ScenarioService
      return makeSensitivityService(scenarioService)
    }),
  )
}

/**
 * Optimization objective definition.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class Objective extends Schema.Class<Objective>("Objective")({
  target: Schema.String,
  direction: Schema.Literal("maximize", "minimize"),
  atTime: Schema.Number,
}) {}

/**
 * Parameter constraint used during optimization.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class Constraint extends Schema.Class<Constraint>("Constraint")({
  parameter: Schema.String,
  min: Schema.Number,
  max: Schema.Number,
}) {}

/**
 * Result of the optimization pass.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class OptimizationResult extends Schema.Class<OptimizationResult>(
  "OptimizationResult",
)({
  objective: Objective,
  bestParameters: Schema.Record({ key: Schema.String, value: Schema.Number }),
  value: Schema.Number,
  iterations: Schema.Number,
  strategy: Schema.String,
}) {}

/**
 * Errors that can surface during optimization.
 *
 * @category Errors
 * @since 0.1.0
 */
export type OptimizationError = ScenarioRuntimeError

export interface OptimizationOptions {
  readonly stepsPerParameter?: number
  readonly iterations?: number
  readonly strategy?: OptimizationStrategy | "grid" | "random"
  readonly scenarioOptions?: ScenarioRunOptions
}

export interface OptimizationContext {
  readonly model: Model
  readonly objective: Objective
  readonly constraints: ReadonlyArray<Constraint>
  readonly scenarioService: ScenarioServiceHandle
  readonly options: OptimizationOptions
}

export interface OptimizationStrategyResult {
  readonly bestParameters: Record<string, number>
  readonly bestValue: number
  readonly iterations: number
}

export interface OptimizationStrategy {
  readonly name: string
  readonly optimize: (
    context: OptimizationContext,
  ) => Effect.Effect<OptimizationStrategyResult, OptimizationError, Solver | UnitManager>
}

const makeOptimizerService = (scenarioService: ScenarioServiceHandle) => ({
  optimize: (
    model: Model,
    objective: Objective,
    constraints: ReadonlyArray<Constraint>,
    options: OptimizationOptions = {},
  ): Effect.Effect<OptimizationResult, OptimizationError, Solver | UnitManager> =>
    Effect.gen(function* () {
      const strategy = resolveStrategy(options)
      const result = yield* strategy.optimize({
        model,
        objective,
        constraints,
        scenarioService,
        options,
      })

      return new OptimizationResult({
        objective,
        bestParameters: result.bestParameters,
        value: result.bestValue,
        iterations: result.iterations,
        strategy: strategy.name,
      })
    }),
})

export interface OptimizerServiceHandle {
  readonly optimize: (
    model: Model,
    objective: Objective,
    constraints: ReadonlyArray<Constraint>,
    options?: OptimizationOptions,
  ) => Effect.Effect<OptimizationResult, OptimizationError, Solver | UnitManager>
}

/**
 * Optimizer service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export class OptimizerService extends Context.Tag(
  "@org/effect-system-dynamics/OptimizerService",
)<OptimizerService, OptimizerServiceHandle>() {
  static layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const scenarioService = yield* ScenarioService
      return makeOptimizerService(scenarioService)
    }),
  )
}

/**
 * Aggregated layer wiring Scenario, Sensitivity, and Optimizer services.
 *
 * Provide this layer in combination with `Solver`, `EquationEvaluator`, and `UnitManager`
 * so all scenario pipelines share a consistent service bundle.
 *
 * @category Layers
 * @since 0.1.0
 */
export const ScenarioServicesLayer = Layer.provideMerge(
  Layer.provideMerge(ScenarioService.layer)(SensitivityService.layer),
)(OptimizerService.layer)
