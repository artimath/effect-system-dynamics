/**
 * Solver service interface for Effect System Dynamics.
 *
 * Provides a Context.Tag that exposes solver implementations (e.g., Euler,
 * RK4). Each solver advertises its name and a `step` function that advances the
 * simulation state by a timestep. Concrete solver layers will be attached as
 * static properties on this tag in subsequent PRs.
 *
 * @since 0.1.0
 */

import { Context, Effect, Layer, Ref } from "effect"
import { ConvergenceError, InvalidTimeStepError, SolverTypeId } from "./Errors.js"
import { Model, Stock, Flow } from "./Model.js"
import { SimState, SimUnits, type DynamicsSnapshot } from "./Simulation.js"
import { EquationEvaluationError, EquationParseError } from "./internal/equations/errors.js"
import {
  Quantity,
  UnitMap,
  makeQuantity,
  divideUnits,
  equalUnits,
} from "./internal/equations/Quantity.js"
import { parseUnitsLiteral, type EquationEvaluationOptions } from "./internal/equations/EquationEngine.js"
import {
  compileEquationGraph,
  evaluateEquationGraph,
  EquationGraphCycleError,
  type CompiledEquationGraph,
} from "./internal/equations/GraphEngine.js"
import { UnitManager, type UnitManagerService, UnitNotFoundError } from "./Units.js"
import { DelayStateStore } from "./internal/equations/v2/DelayState.js"
import { EquationDsl } from "./Equations.js"

const solverIdentifier = Symbol.keyFor(SolverTypeId) ?? "@org/effect-system-dynamics/Solver"
const MIN_TIME_STEP = 1e-6
const MAX_TIME_STEP = 1.0

const DEFAULT_TIME_UNIT_LABEL = "tick"

const defaultTimeUnit = (): UnitMap => ({ [DEFAULT_TIME_UNIT_LABEL]: 1 })

const DORMAND_PRINCE_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1] as const

const DORMAND_PRINCE_A: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
]

const DORMAND_PRINCE_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0] as const
const DORMAND_PRINCE_B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40] as const

const ADAPTIVE_ERROR_EXPONENT = -0.2 // -1/5 power used for Dormand–Prince controller

export interface AdaptiveSolverOptions {
  readonly initialStep?: number
  readonly minStep?: number
  readonly maxStep?: number
  readonly safetyFactor?: number
  readonly growthLimit?: number
  readonly shrinkLimit?: number
  readonly absoluteTolerance?: number | Record<string, number>
  readonly relativeTolerance?: number | Record<string, number>
  readonly maxAttemptsPerStep?: number
}

interface ResolvedAdaptiveOptions {
  readonly initialStep: number
  readonly minStep: number
  readonly maxStep: number
  readonly safetyFactor: number
  readonly growthLimit: number
  readonly shrinkLimit: number
  readonly absoluteTolerance: number | Record<string, number>
  readonly relativeTolerance: number | Record<string, number>
  readonly absoluteToleranceDefault: number
  readonly relativeToleranceDefault: number
  readonly maxAttemptsPerStep: number
}

const defaultAdaptiveOptions: ResolvedAdaptiveOptions = {
  initialStep: 0.1,
  minStep: 1e-6,
  maxStep: 1.0,
  safetyFactor: 0.9,
  growthLimit: 5.0,
  shrinkLimit: 0.2,
  absoluteTolerance: 1e-6,
  relativeTolerance: 1e-3,
  absoluteToleranceDefault: 1e-6,
  relativeToleranceDefault: 1e-3,
  maxAttemptsPerStep: 12,
}

const stockUnitsCache = new WeakMap<Stock, UnitMap>()
const flowUnitsCache = new WeakMap<Flow, UnitMap>()
const variableGraphCache = new WeakMap<Model, CompiledEquationGraph>()
const delayStateCache = new WeakMap<Model, DelayStateStore>()
const flowEquationCache = new WeakMap<Flow, { readonly source: string; readonly ast: EquationDsl.EquationNode }>()
const stockOrderCache = new WeakMap<Model, ReadonlyArray<string>>()
const modelUnitsCache = new WeakMap<Model, ModelUnitMetadata>()

interface ModelUnitMetadata {
  readonly timeUnit: UnitMap
  readonly stockUnitsById: Map<string, UnitMap>
  readonly stockNamesById: Map<string, string>
  readonly stockUnitsRecord: Record<string, UnitMap>
  readonly rateUnitsRecord: Record<string, UnitMap>
  readonly stockOrder: ReadonlyArray<string>
}

const getDelayStateStore = (model: Model, state: SimState): DelayStateStore => {
  const cached = delayStateCache.get(model)
  const startTime = model.timeConfig.start
  if (state.time <= startTime + 1e-12) {
    const fresh = new DelayStateStore()
    delayStateCache.set(model, fresh)
    return fresh
  }
  if (cached) {
    return cached
  }
  const created = new DelayStateStore()
  delayStateCache.set(model, created)
  return created
}

const replaceDelayStateStore = (model: Model, store: DelayStateStore) => {
  delayStateCache.set(model, store)
}

const getStockOrder = (model: Model): ReadonlyArray<string> => {
  const cached = stockOrderCache.get(model)
  if (cached) {
    return cached
  }
  const order = model.stocks.map((stock) => stock.id)
  stockOrderCache.set(model, order)
  return order
}

const getModelUnitMetadata = (
  unitManager: UnitManagerService,
  model: Model,
): Effect.Effect<ModelUnitMetadata, EquationEvaluationError> =>
  Effect.gen(function* () {
    const cached = modelUnitsCache.get(model)
    if (cached) {
      return cached
    }

    const timeUnit = yield* getTimeUnit(unitManager, model)
    const stockUnitsById = new Map<string, UnitMap>()
    const stockNamesById = new Map<string, string>()
    const stockUnitsRecord: Record<string, UnitMap> = Object.create(null)
    const rateUnitsRecord: Record<string, UnitMap> = Object.create(null)
    const stockOrder = getStockOrder(model)

    for (const stock of model.stocks) {
      const units = yield* getStockUnits(unitManager, stock)
      stockUnitsById.set(stock.id, units)
      stockNamesById.set(stock.id, stock.name)
      stockUnitsRecord[stock.id] = { ...units }
      rateUnitsRecord[stock.id] = divideUnits(units, timeUnit)
    }

    const metadata: ModelUnitMetadata = {
      timeUnit: { ...timeUnit },
      stockUnitsById,
      stockNamesById,
      stockUnitsRecord,
      rateUnitsRecord,
      stockOrder,
    }

    modelUnitsCache.set(model, metadata)
    return metadata
  })

const createZeroRateRecord = (stockOrder: ReadonlyArray<string>): Record<string, number> => {
  const result: Record<string, number> = Object.create(null)
  for (let index = 0; index < stockOrder.length; index += 1) {
    const id = stockOrder[index]
    if (id) {
      result[id] = 0
    }
  }
  return result
}

const computeEulerStepFast = (
  stockIds: ReadonlyArray<string>,
  stocks: Record<string, number>,
  rates: Record<string, number>,
  dt: number,
): Record<string, number> => {
  const result: Record<string, number> = Object.create(null)
  for (let index = 0; index < stockIds.length; index += 1) {
    const id = stockIds[index]!
    const base = stocks[id] ?? 0
    const rate = rates[id] ?? 0
    result[id] = base + rate * dt
  }
  return result
}

const blendRK4RatesFast = (
  stockIds: ReadonlyArray<string>,
  k1: Record<string, number>,
  k2: Record<string, number>,
  k3: Record<string, number>,
  k4: Record<string, number>,
): Record<string, number> => {
  const result: Record<string, number> = Object.create(null)
  for (let index = 0; index < stockIds.length; index += 1) {
    const id = stockIds[index]!
    result[id] =
      ((k1[id] ?? 0) +
        2 * (k2[id] ?? 0) +
        2 * (k3[id] ?? 0) +
        (k4[id] ?? 0)) / 6
  }
  return result
}

const combineRatesFast = (
  stockIds: ReadonlyArray<string>,
  base: Record<string, number>,
  rates: ReadonlyArray<Record<string, number>>,
  coefficients: ReadonlyArray<number>,
  dt: number,
): Record<string, number> => {
  const result: Record<string, number> = Object.create(null)
  for (let index = 0; index < stockIds.length; index += 1) {
    const id = stockIds[index]!
    let value = base[id] ?? 0
    for (let rateIndex = 0; rateIndex < rates.length; rateIndex += 1) {
      const coefficient = coefficients[rateIndex]
      if (coefficient === undefined) {
        continue
      }
      const rateRecord = rates[rateIndex]
      const rate = rateRecord ? rateRecord[id] : undefined
      if (rate !== undefined) {
        value += dt * coefficient * rate
      }
    }
    result[id] = value
  }
  return result
}

const ensureValidTimeStep = (dt: number) =>
  dt > 0 && Number.isFinite(dt)
    ? Effect.succeed(undefined)
    : Effect.fail(new InvalidTimeStepError({ dt, min: MIN_TIME_STEP, max: MAX_TIME_STEP }))

const cloneUnitMapRecord = (record: Record<string, UnitMap>): Record<string, UnitMap> => {
  const result: Record<string, UnitMap> = Object.create(null)
  for (const [key, value] of Object.entries(record)) {
    result[key] = { ...value }
  }
  return result
}

const cloneNumberRecord = (record: Record<string, number>): Record<string, number> => {
  const result: Record<string, number> = Object.create(null)
  for (const [key, value] of Object.entries(record)) {
    result[key] = value
  }
  return result
}

const makeIntermediateState = (
  base: SimState,
  stocks: Record<string, number>,
  variables: Record<string, number>,
  time: number,
): SimState =>
  new SimState({
    time,
    stocks,
    variables,
    units: base.units,
  })

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const ensureUnitsKnown = (
  unitManager: UnitManagerService,
  units: UnitMap,
  context: string,
): Effect.Effect<void, EquationEvaluationError> =>
  unitManager.ensureUnitMap(units).pipe(
    Effect.catchTag("UnitNotFoundError", (error: UnitNotFoundError) =>
      Effect.fail(
        new EquationEvaluationError({
          expression: context,
          problem: `Unit "${error.symbol}" is not registered`,
        }),
      ),
    ),
  )

const parseUnitsWithManager = (
  unitManager: UnitManagerService,
  units: string | undefined,
  context: string,
): Effect.Effect<UnitMap, EquationEvaluationError> =>
  Effect.try({
    try: () => {
      if (!units || units.trim().length === 0) {
        return Object.create(null)
      }
      return parseUnitsLiteral(units)
    },
    catch: (error) => {
      if (error instanceof EquationParseError) {
        throw new EquationEvaluationError({
          expression: context,
          problem: error.problem,
        })
      }
      if (error instanceof EquationEvaluationError) {
        throw new EquationEvaluationError({
          expression: context,
          problem: error.problem,
        })
      }
      throw new EquationEvaluationError({
        expression: context,
        problem: error instanceof Error ? error.message : String(error),
      })
    },
  }).pipe(Effect.tap((unitMap) => ensureUnitsKnown(unitManager, unitMap, context)))

const getStockUnits = (
  unitManager: UnitManagerService,
  stock: Stock,
): Effect.Effect<UnitMap, EquationEvaluationError> => {
  const cached = stockUnitsCache.get(stock)
  if (cached) {
    return Effect.succeed(cached)
  }
  return Effect.tap(
    parseUnitsWithManager(unitManager, stock.units, `Stock "${stock.name}" units`),
    (parsed) => Effect.sync(() => {
      stockUnitsCache.set(stock, parsed)
    }),
  )
}

const getFlowDeclaredUnits = (
  unitManager: UnitManagerService,
  flow: Flow,
): Effect.Effect<UnitMap, EquationEvaluationError> => {
  const cached = flowUnitsCache.get(flow)
  if (cached) {
    return Effect.succeed(cached)
  }
  return Effect.tap(
    parseUnitsWithManager(unitManager, flow.units, `Flow "${flow.name}" units`),
    (parsed) => Effect.sync(() => {
      flowUnitsCache.set(flow, parsed)
    }),
  )
}

const getFlowEquationAst = (
  flow: Flow,
): Effect.Effect<EquationDsl.EquationNode, EquationEvaluationError> =>
  Effect.try({
    try: () => {
      const cached = flowEquationCache.get(flow)
      if (cached && cached.source === flow.rateEquation) {
        return cached.ast
      }
      const ast = EquationDsl.parseEquationAst(flow.rateEquation)
      flowEquationCache.set(flow, { source: flow.rateEquation, ast })
      return ast
    },
    catch: (error) => {
      if (error instanceof EquationDsl.EquationDiagnosticError) {
        throw new EquationEvaluationError({
          expression: flow.rateEquation,
          problem: error.diagnostic.message,
        })
      }
      throw error
    },
  })

const getTimeUnit = (
  unitManager: UnitManagerService,
  model: Model,
): Effect.Effect<UnitMap, EquationEvaluationError> =>
  Effect.gen(function* () {
    const config = model.timeConfig as { readonly units?: string | undefined }
    const configured = config.units
    if (configured && configured.trim().length > 0) {
      return yield* parseUnitsWithManager(unitManager, configured, "Time configuration units")
    }
    const unitMap = defaultTimeUnit()
    yield* ensureUnitsKnown(unitManager, unitMap, "Time configuration units")
    return unitMap
  })

const getCompiledGraph = (
  model: Model,
): Effect.Effect<CompiledEquationGraph, EquationEvaluationError> =>
  Effect.gen(function* () {
    const cached = variableGraphCache.get(model)
    if (cached) {
      return cached
    }
    const compiled = yield* compileEquationGraph(model.variables).pipe(
      Effect.mapError((error) =>
        new EquationEvaluationError({
          expression: model.name,
          problem:
            error instanceof EquationGraphCycleError
              ? `Equation cycle detected: ${error.nodes.join(" -> ")}`
              : error.reason,
        }),
      ),
    )
    variableGraphCache.set(model, compiled)
    return compiled
  })

const evaluateFlowEquation = (
  flow: Flow,
  scope: Record<string, Quantity>,
  options: EquationEvaluationOptions,
): Effect.Effect<Quantity, EquationEvaluationError> =>
  Effect.gen(function* () {
    const ast = yield* getFlowEquationAst(flow)
    return yield* Effect.try({
      try: () => EquationDsl.evaluateEquationAst(ast, scope, flow.rateEquation, options),
      catch: (error) => {
        if (error instanceof EquationEvaluationError) {
          throw error
        }
        throw new EquationEvaluationError({
          expression: flow.rateEquation,
          problem: error instanceof Error ? error.message : String(error),
        })
      },
    })
  })

const resolveAdaptiveOptions = (overrides?: AdaptiveSolverOptions): ResolvedAdaptiveOptions => {
  if (!overrides) {
    return { ...defaultAdaptiveOptions }
  }

  const absoluteTolerance = overrides.absoluteTolerance ?? defaultAdaptiveOptions.absoluteTolerance
  const relativeTolerance = overrides.relativeTolerance ?? defaultAdaptiveOptions.relativeTolerance

  const minStep = overrides.minStep ?? defaultAdaptiveOptions.minStep
  const maxStep = overrides.maxStep ?? defaultAdaptiveOptions.maxStep
  const safeMin = Math.min(minStep, maxStep)
  const safeMax = Math.max(minStep, maxStep)

  const initialRequested = overrides.initialStep ?? defaultAdaptiveOptions.initialStep
  const initialStep = clampNumber(initialRequested, safeMin, safeMax)

  const safetyFactor = overrides.safetyFactor ?? defaultAdaptiveOptions.safetyFactor
  const growthLimit = overrides.growthLimit ?? defaultAdaptiveOptions.growthLimit
  const shrinkLimit = overrides.shrinkLimit ?? defaultAdaptiveOptions.shrinkLimit

  const absoluteToleranceDefault =
    typeof absoluteTolerance === "number"
      ? absoluteTolerance
      : defaultAdaptiveOptions.absoluteToleranceDefault

  const relativeToleranceDefault =
    typeof relativeTolerance === "number"
      ? relativeTolerance
      : defaultAdaptiveOptions.relativeToleranceDefault

  const maxAttemptsPerStep = overrides.maxAttemptsPerStep ?? defaultAdaptiveOptions.maxAttemptsPerStep

  return {
    initialStep,
    minStep: safeMin,
    maxStep: safeMax,
    safetyFactor: Math.max(1e-3, safetyFactor),
    growthLimit: Math.max(1, growthLimit),
    shrinkLimit: Math.min(1, Math.max(1e-3, shrinkLimit)),
    absoluteTolerance,
    relativeTolerance,
    absoluteToleranceDefault,
    relativeToleranceDefault,
    maxAttemptsPerStep: Math.max(1, maxAttemptsPerStep),
  }
}

const toleranceForStock = (
  tolerance: number | Record<string, number>,
  fallback: number,
  stockId: string,
): number => {
  if (typeof tolerance === "number") {
    return tolerance
  }
  const specific = tolerance[stockId]
  return specific === undefined ? fallback : specific
}

const computeAdaptiveError = (
  baseStocks: Record<string, number>,
  highOrder: Record<string, number>,
  lowOrder: Record<string, number>,
  options: ResolvedAdaptiveOptions,
): number => {
  const stockIds = new Set<string>([
    ...Object.keys(baseStocks),
    ...Object.keys(highOrder),
    ...Object.keys(lowOrder),
  ])

  if (stockIds.size === 0) {
    return 0
  }

  let sum = 0
  for (const stockId of stockIds) {
    const highValue = highOrder[stockId] ?? 0
    const lowValue = lowOrder[stockId] ?? highValue
    const baseValue = baseStocks[stockId] ?? highValue

    const absTol = toleranceForStock(options.absoluteTolerance, options.absoluteToleranceDefault, stockId)
    const relTol = toleranceForStock(options.relativeTolerance, options.relativeToleranceDefault, stockId)

    const scale = absTol + relTol * Math.max(Math.abs(baseValue), Math.abs(highValue))
    const ratio = scale === 0 ? 0 : Math.abs(highValue - lowValue) / scale
    sum += ratio * ratio
  }

  return Math.sqrt(sum / stockIds.size)
}

const toSimUnits = (dynamics: DynamicsSnapshot): SimUnits =>
  new SimUnits({
    stocks: cloneUnitMapRecord(dynamics.stockUnits),
    variables: cloneUnitMapRecord(dynamics.variableUnits),
    rates: cloneUnitMapRecord(dynamics.rateUnits),
    time: { ...dynamics.timeUnit },
  })

const advanceState = (
  state: SimState,
  dt: number,
  stocks: Record<string, number>,
  end: number,
  dynamics: DynamicsSnapshot,
) =>
  new SimState({
    time: Math.min(state.time + dt, end),
    stocks,
    variables: dynamics.variables,
    units: toSimUnits(dynamics),
  })

/**
 * Context tag describing the solver interface contract.
 *
 * @category Services
 * @since 0.1.0
 */
export class Solver extends Context.Tag(solverIdentifier)<
  Solver,
  {
    readonly name: string
    readonly step: (
      model: Model,
      state: SimState,
      dt: number,
    ) => Effect.Effect<
      SimState,
      ConvergenceError | InvalidTimeStepError | EquationEvaluationError,
      UnitManager
    >
  }
>() {
  /**
   * Baseline explicit Euler solver.
   *
    * @example
    * ```ts
    * const result = await Effect.runPromise(
    *   solver.step(model, state, 0.1).pipe(Effect.provide(Solver.Euler))
    * )
    * ```
   *
   * @category Layers
   * @since 0.1.0
   */
  static readonly Euler = Layer.succeed(this, {
    name: "Euler",
    step: (model: Model, state: SimState, dt: number) =>
      Effect.gen(function* () {
        yield* ensureValidTimeStep(dt)
        const stockOrder = getStockOrder(model)
        const unitManager = yield* UnitManager
        const baseDelayState = getDelayStateStore(model, state)
        const workingDelayState = baseDelayState.clone()
        const dynamics = yield* computeDynamics(
          unitManager,
          model,
          state,
          workingDelayState,
          true,
        )
        replaceDelayStateStore(model, workingDelayState)
        const nextStocks = computeEulerStepFast(stockOrder, state.stocks, dynamics.rates, dt)
        return advanceState(state, dt, nextStocks, model.timeConfig.end, dynamics)
      }),
  })

  /**
   * Placeholder RK4 solver that currently mirrors the Euler implementation.
   *
    * @example
    * ```ts
    * const result = await Effect.runPromise(
    *   solver.step(model, state, 0.1).pipe(Effect.provide(Solver.RK4))
    * )
    * ```
   *
   * @category Layers
   * @since 0.1.0
   */
  static readonly RK4 = Layer.succeed(this, {
    name: "RK4",
    step: (model: Model, state: SimState, dt: number) =>
      Effect.gen(function* () {
        yield* ensureValidTimeStep(dt)
        const stockOrder = getStockOrder(model)
        const unitManager = yield* UnitManager

        const end = model.timeConfig.end
        const baseTime = state.time
        const remaining = end - baseTime
        const effectiveTimeStep = remaining > 0 ? Math.min(dt, remaining) : dt

        const baseDelayState = getDelayStateStore(model, state)
        const workingDelayState = baseDelayState.clone()
        const stage1 = yield* computeDynamics(
          unitManager,
          model,
          state,
          workingDelayState,
          false,
        )

        const halfStep = effectiveTimeStep / 2
        const stage2State = makeIntermediateState(
          state,
          computeEulerStepFast(stockOrder, state.stocks, stage1.rates, halfStep),
          cloneNumberRecord(stage1.variables),
          Math.min(baseTime + halfStep, end),
        )
        const stage2 = yield* computeDynamics(
          unitManager,
          model,
          stage2State,
          workingDelayState,
          false,
        )

        const stage3State = makeIntermediateState(
          state,
          computeEulerStepFast(stockOrder, state.stocks, stage2.rates, halfStep),
          cloneNumberRecord(stage2.variables),
          Math.min(baseTime + halfStep, end),
        )
        const stage3 = yield* computeDynamics(
          unitManager,
          model,
          stage3State,
          workingDelayState,
          false,
        )

        const stage4State = makeIntermediateState(
          state,
          computeEulerStepFast(stockOrder, state.stocks, stage3.rates, effectiveTimeStep),
          cloneNumberRecord(stage3.variables),
          Math.min(baseTime + effectiveTimeStep, end),
        )
        const stage4 = yield* computeDynamics(
          unitManager,
          model,
          stage4State,
          workingDelayState,
          false,
        )

        const blendedRates = blendRK4RatesFast(
          stockOrder,
          stage1.rates,
          stage2.rates,
          stage3.rates,
          stage4.rates,
        )

        const nextStocks = computeEulerStepFast(
          stockOrder,
          state.stocks,
          blendedRates,
          effectiveTimeStep,
        )

        const finalState = makeIntermediateState(
          state,
          nextStocks,
          cloneNumberRecord(stage4.variables),
          Math.min(baseTime + effectiveTimeStep, end),
        )
        const finalDynamics = yield* computeDynamics(
          unitManager,
          model,
          finalState,
          workingDelayState,
          true,
        )
        replaceDelayStateStore(model, workingDelayState)

        return advanceState(state, effectiveTimeStep, nextStocks, end, finalDynamics)
      }),
  })

  static Adaptive(options?: AdaptiveSolverOptions) {
    return Layer.effect(this, Effect.gen(function* () {
      const resolved = resolveAdaptiveOptions(options)
      const stepRef = yield* Ref.make(resolved.initialStep)

      return {
        name: "Adaptive",
        step: (model: Model, state: SimState, dt: number) =>
          Effect.gen(function* () {
            yield* ensureValidTimeStep(dt)
            const unitManager = yield* UnitManager
            const stockOrder = getStockOrder(model)
            const baseDelayState = getDelayStateStore(model, state)
            let persistentDelayState = baseDelayState.clone()

            const end = model.timeConfig.end
            if (state.time >= end) {
              return state
            }

            const targetTotal = Math.min(dt, end - state.time)
            if (targetTotal <= 0) {
              return state
            }

            let workingState = state
            let elapsed = 0
            let nextStep = clampNumber(yield* Ref.get(stepRef), resolved.minStep, resolved.maxStep)
            let lastError = 0

            while (elapsed + 1e-12 < targetTotal) {
              const remaining = targetTotal - elapsed
              let currentStep = clampNumber(nextStep, resolved.minStep, Math.min(resolved.maxStep, remaining))
              let attempts = 0
              let accepted = false

              while (!accepted) {
                attempts += 1
                if (attempts > resolved.maxAttemptsPerStep || currentStep < resolved.minStep - 1e-12) {
                  return yield* Effect.fail(
                    new ConvergenceError({
                      model: model.id,
                      timeStep: workingState.time,
                      error: lastError,
                    }),
                  )
                }

                const baseStocks = workingState.stocks
                const baseTime = workingState.time
                const attemptDelayState = persistentDelayState.clone()
                const stage1 = yield* computeDynamics(
                  unitManager,
                  model,
                  workingState,
                  attemptDelayState,
                  false,
                )
                const rates: Array<Record<string, number>> = [stage1.rates]

                const buildStage = (
                  coefficients: ReadonlyArray<number>,
                  timeFraction: number,
                  previousDynamics: DynamicsSnapshot,
                ) =>
                  makeIntermediateState(
                    workingState,
                    combineRatesFast(stockOrder, baseStocks, rates, coefficients, currentStep),
                    cloneNumberRecord(previousDynamics.variables),
                    Math.min(baseTime + timeFraction * currentStep, end),
                  )

                const stage2State = buildStage(DORMAND_PRINCE_A[1]!, DORMAND_PRINCE_C[1], stage1)
                const stage2 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage2State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage2.rates)

                const stage3State = buildStage(DORMAND_PRINCE_A[2]!, DORMAND_PRINCE_C[2], stage2)
                const stage3 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage3State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage3.rates)

                const stage4State = buildStage(DORMAND_PRINCE_A[3]!, DORMAND_PRINCE_C[3], stage3)
                const stage4 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage4State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage4.rates)

                const stage5State = buildStage(DORMAND_PRINCE_A[4]!, DORMAND_PRINCE_C[4], stage4)
                const stage5 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage5State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage5.rates)

                const stage6State = buildStage(DORMAND_PRINCE_A[5]!, DORMAND_PRINCE_C[5], stage5)
                const stage6 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage6State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage6.rates)

                const stage7State = buildStage(DORMAND_PRINCE_A[6]!, DORMAND_PRINCE_C[6], stage6)
                const stage7 = yield* computeDynamics(
                  unitManager,
                  model,
                  stage7State,
                  attemptDelayState,
                  false,
                )
                rates.push(stage7.rates)

                const highOrderStocks = combineRatesFast(
                  stockOrder,
                  baseStocks,
                  rates,
                  DORMAND_PRINCE_B5,
                  currentStep,
                )
                const lowOrderStocks = combineRatesFast(
                  stockOrder,
                  baseStocks,
                  rates,
                  DORMAND_PRINCE_B4,
                  currentStep,
                )

                const error = computeAdaptiveError(baseStocks, highOrderStocks, lowOrderStocks, resolved)
                lastError = error

                const errorRatio = Number.isFinite(error) ? error : Number.POSITIVE_INFINITY

                if (errorRatio <= 1) {
                  const finalStateCandidate = makeIntermediateState(
                    workingState,
                    highOrderStocks,
                    cloneNumberRecord(stage7.variables),
                    Math.min(baseTime + currentStep, end),
                  )
                  const finalDynamics = yield* computeDynamics(
                    unitManager,
                    model,
                    finalStateCandidate,
                    attemptDelayState,
                    true,
                  )
                  workingState = advanceState(workingState, currentStep, highOrderStocks, end, finalDynamics)
                  elapsed += currentStep
                  persistentDelayState = attemptDelayState

                  const scaleBase = errorRatio === 0
                    ? resolved.growthLimit
                    : resolved.safetyFactor * Math.pow(Math.max(errorRatio, 1e-12), ADAPTIVE_ERROR_EXPONENT)
                  const boundedScale = clampNumber(scaleBase, resolved.shrinkLimit, resolved.growthLimit)
                  nextStep = clampNumber(
                    currentStep * boundedScale,
                    resolved.minStep,
                    resolved.maxStep,
                  )

                  accepted = true
                } else {
                  const scaleBase = resolved.safetyFactor * Math.pow(Math.max(errorRatio, 1e-12), ADAPTIVE_ERROR_EXPONENT)
                  const boundedScale = Math.max(resolved.shrinkLimit, scaleBase)
                  const proposed = currentStep * boundedScale
                  currentStep = clampNumber(
                    Math.max(proposed, resolved.minStep),
                    resolved.minStep,
                    Math.min(resolved.maxStep, remaining),
                  )
                }
              }
            }

            yield* Ref.set(stepRef, nextStep)
            replaceDelayStateStore(model, persistentDelayState)
            return workingState
          }),
      }
    }))
  }
}

const isUnitlessMap = (units: UnitMap): boolean => Object.keys(units).length === 0

const formatUnits = (units: UnitMap): string => {
  const entries = Object.entries(units)
  if (entries.length === 0) {
    return "unitless"
  }
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, exponent]) => {
      const rounded = Math.round(exponent * 1e12) / 1e12
      if (Math.abs(rounded - 1) <= 1e-12) {
        return name
      }
      return `${name}^${rounded}`
    })
    .join(" · ")
}

const buildScope = (
  model: Model,
  state: SimState,
  stockUnitsById: Map<string, UnitMap>,
  timeUnit: UnitMap,
): Record<string, Quantity> => {
  const scope: Record<string, Quantity> = Object.create(null)

  for (const stock of model.stocks) {
    const units = stockUnitsById.get(stock.id) ?? Object.create(null)
    const value = state.stocks[stock.id] ?? stock.initialValue
    const quantity = makeQuantity(value, units)
    scope[stock.name] = quantity
    scope[stock.id] = quantity
  }

  for (const [id, value] of Object.entries(state.variables)) {
    scope[id] = makeQuantity(value)
  }

  for (const variable of model.variables) {
    const stateValue = state.variables[variable.id]
    if (stateValue !== undefined) {
      scope[variable.name] = makeQuantity(stateValue)
    }
  }

  const timeQuantity = makeQuantity(state.time, timeUnit)
  const stepQuantity = makeQuantity(model.timeConfig.step, timeUnit)
  const startQuantity = makeQuantity(model.timeConfig.start, timeUnit)
  const endQuantity = makeQuantity(model.timeConfig.end, timeUnit)

  const assignAliases = (quantity: Quantity, aliases: ReadonlyArray<string>) => {
    for (const alias of aliases) {
      scope[alias] = quantity
    }
  }

  assignAliases(timeQuantity, ["time", "TIME", "Time"])
  assignAliases(stepQuantity, ["timeStep", "TIME STEP", "TIME_STEP", "dt"])
  assignAliases(startQuantity, ["initialTime", "INITIAL TIME"])
  assignAliases(endQuantity, ["finalTime", "FINAL TIME"])

  return scope
}

const validateFlowQuantity = (
  flow: Flow,
  quantity: Quantity,
  declaredUnits: UnitMap,
  stockUnitsById: Map<string, UnitMap>,
  stockNamesById: Map<string, string>,
  timeUnit: UnitMap,
  rateUnitsByStockId: Record<string, UnitMap>,
): Effect.Effect<void, EquationEvaluationError> =>
  Effect.gen(function* () {
    const attached: Array<{ readonly stockId: string; readonly units: UnitMap }> = []

    if (flow.source) {
      const sourceUnits = stockUnitsById.get(flow.source)
      if (!sourceUnits) {
        yield* Effect.fail(
          new EquationEvaluationError({
            expression: flow.rateEquation,
            problem: `Flow "${flow.name}" references unknown source stock "${flow.source}"`,
          }),
        )
      }
      attached.push({ stockId: flow.source, units: sourceUnits ?? Object.create(null) })
    }

    if (flow.target) {
      const targetUnits = stockUnitsById.get(flow.target)
      if (!targetUnits) {
        yield* Effect.fail(
          new EquationEvaluationError({
            expression: flow.rateEquation,
            problem: `Flow "${flow.name}" references unknown target stock "${flow.target}"`,
          }),
        )
      }
      attached.push({ stockId: flow.target, units: targetUnits ?? Object.create(null) })
    }

    if (attached.length > 1) {
      const reference = attached[0]
      if (!reference) {
        return
      }
      for (let index = 1; index < attached.length; index += 1) {
        const candidate = attached[index]
        if (candidate && !equalUnits(reference.units, candidate.units)) {
          yield* Effect.fail(
            new EquationEvaluationError({
              expression: flow.rateEquation,
              problem: `Flow "${flow.name}" connects stocks with incompatible units (${formatUnits(reference.units)} vs ${formatUnits(candidate.units)})`,
            }),
          )
        }
      }
    }

    if (attached.length > 0) {
      const representative = attached[0]
      if (!representative) {
        return
      }
      const expected = rateUnitsByStockId[representative.stockId] ?? divideUnits(representative.units, timeUnit)
      if (!equalUnits(quantity.units, expected)) {
        const stockName = stockNamesById.get(representative.stockId) ?? representative.stockId
        yield* Effect.fail(
          new EquationEvaluationError({
            expression: flow.rateEquation,
            problem: `Flow "${flow.name}" produced ${formatUnits(quantity.units)} but "${stockName}" requires ${formatUnits(expected)} per time unit`,
          }),
        )
      }
      if (!isUnitlessMap(declaredUnits) && !equalUnits(declaredUnits, expected)) {
        yield* Effect.fail(
          new EquationEvaluationError({
            expression: flow.rateEquation,
            problem: `Flow "${flow.name}" declares units ${formatUnits(declaredUnits)} but connected stocks imply ${formatUnits(expected)}`,
          }),
        )
      }
      return
    }

    if (!isUnitlessMap(declaredUnits) && !equalUnits(quantity.units, declaredUnits)) {
      yield* Effect.fail(
        new EquationEvaluationError({
          expression: flow.rateEquation,
          problem: `Flow "${flow.name}" declares units ${formatUnits(declaredUnits)} but equation produced ${formatUnits(quantity.units)}`,
        }),
      )
    }
  })

const addRateContribution = (
  rates: Record<string, number>,
  rateUnits: Record<string, UnitMap>,
  stockId: string,
  rateQuantity: Quantity,
  multiplier: 1 | -1,
  flow: Flow,
  stockNamesById: Map<string, string>,
): Effect.Effect<void, EquationEvaluationError> =>
  Effect.gen(function* () {
    const expectedUnits = rateUnits[stockId]
    if (!expectedUnits) {
      yield* Effect.fail(
        new EquationEvaluationError({
          expression: flow.rateEquation,
          problem: `Flow "${flow.name}" references stock "${stockId}" with no registered units`,
        }),
      )
    }

    if (!equalUnits(expectedUnits ?? Object.create(null), rateQuantity.units)) {
      const stockName = stockNamesById.get(stockId) ?? stockId
      yield* Effect.fail(
        new EquationEvaluationError({
          expression: flow.rateEquation,
          problem: `Flow "${flow.name}" produced rate units ${formatUnits(rateQuantity.units)} incompatible with ${formatUnits(expectedUnits ?? Object.create(null))} for stock "${stockName}"`,
        }),
      )
    }

    const previous = rates[stockId] ?? 0
    rates[stockId] = previous + multiplier * rateQuantity.value
  })

const computeDynamics = (
  unitManager: UnitManagerService,
  model: Model,
  state: SimState,
  delayState: DelayStateStore,
  commitDelay: boolean,
) =>
  Effect.gen(function* () {
    const metadata = yield* getModelUnitMetadata(unitManager, model)
    const {
      timeUnit,
      stockUnitsById,
      stockNamesById,
      stockUnitsRecord,
      rateUnitsRecord,
      stockOrder,
    } = metadata

    const scope = buildScope(model, state, stockUnitsById, timeUnit)
    const compiledGraph = yield* getCompiledGraph(model)
    const evaluationOptions = { delayState, commit: commitDelay }
    const evaluation = yield* evaluateEquationGraph(compiledGraph, scope, evaluationOptions)
    const resolvedScope = evaluation.scope
    const variableValues = evaluation.values
    const variableUnits = evaluation.units
    const numericRates = createZeroRateRecord(stockOrder)

    for (const flow of model.flows) {
      const rateQuantity = yield* evaluateFlowEquation(flow, resolvedScope, evaluationOptions)
      yield* ensureUnitsKnown(unitManager, rateQuantity.units, `Flow "${flow.name}" equation result`)
      const declaredUnits = yield* getFlowDeclaredUnits(unitManager, flow)
      yield* validateFlowQuantity(
        flow,
        rateQuantity,
        declaredUnits,
        stockUnitsById,
        stockNamesById,
        timeUnit,
        rateUnitsRecord,
      )

      if (flow.source) {
        yield* addRateContribution(
          numericRates,
          rateUnitsRecord,
          flow.source,
          rateQuantity,
          -1,
          flow,
          stockNamesById,
        )
      }

      if (flow.target) {
        yield* addRateContribution(
          numericRates,
          rateUnitsRecord,
          flow.target,
          rateQuantity,
          1,
          flow,
          stockNamesById,
        )
      }
    }

    return {
      rates: numericRates,
      variables: variableValues,
      variableUnits,
      rateUnits: rateUnitsRecord,
      stockUnits: stockUnitsRecord,
      timeUnit,
    }
  })
