/**
 * Simulation State Schema
 *
 * Defines the runtime state snapshot captured at each timestep of a
 * system dynamics simulation. The state records the current simulation time
 * alongside scalar values for all stocks and derived variables. Every numeric
 * value must remain finite so downstream solvers and visualisations never have
 * to defensively guard against `NaN` or `Infinity`.
 *
 * @since 0.1.0
 */

import { Cause, Chunk, Effect, Option, Schema, Stream } from "effect"
import { SolverError } from "./Errors.js"
import { Model } from "./Model.js"
import { Solver } from "./Solver.js"
import { UnitManager } from "./Units.js"
import { EquationEvaluationError, EquationParseError } from "./internal/equations/errors.js"
import { parseUnitsLiteral } from "./internal/equations/EquationEngine.js"
import { UnitMap, divideUnits } from "./internal/equations/Quantity.js"

const UnitExponent = Schema.Number.pipe(Schema.finite())

const UnitMapSchema = Schema.Record({
  key: Schema.String,
  value: UnitExponent,
})

export class SimUnits extends Schema.Class<SimUnits>("SimUnits")({
  stocks: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
  variables: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
  rates: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
  time: UnitMapSchema,
}) {}

const cloneUnitMap = (units: UnitMap): UnitMap => ({ ...units })

const DEFAULT_TIME_UNIT_LABEL = "tick"

const defaultTimeUnit = (): UnitMap => ({ [DEFAULT_TIME_UNIT_LABEL]: 1 })

const parseUnitsOrThrow = (units: string | undefined, context: string): UnitMap => {
  if (!units || units.trim().length === 0) {
    return Object.create(null)
  }
  try {
    return parseUnitsLiteral(units)
  } catch (error) {
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
  }
}

const getModelTimeUnit = (model: Model): UnitMap => {
  const config = model.timeConfig as { readonly units?: string | undefined }
  const configured = config.units
  if (configured && configured.trim().length > 0) {
    return parseUnitsOrThrow(configured, "Time configuration units")
  }
  return defaultTimeUnit()
}

const deriveInitialUnits = (model: Model): SimUnits => {
  const timeUnit = getModelTimeUnit(model)
  const stocks: Record<string, UnitMap> = Object.create(null)
  const rates: Record<string, UnitMap> = Object.create(null)

  for (const stock of model.stocks) {
    const units = parseUnitsOrThrow(stock.units, `Stock "${stock.name}" units`)
    stocks[stock.id] = cloneUnitMap(units)
    rates[stock.id] = divideUnits(units, timeUnit)
  }

  return new SimUnits({
    stocks,
    variables: {},
    rates,
    time: cloneUnitMap(timeUnit),
  })
}

export type DynamicsSnapshot = {
  readonly variables: Record<string, number>
  readonly variableUnits: Record<string, UnitMap>
  readonly rateUnits: Record<string, UnitMap>
  readonly stockUnits: Record<string, UnitMap>
  readonly timeUnit: UnitMap
}

/**
 * Immutable snapshot of a simulation at a single timestep.
 *
 * @category Simulation
 * @since 0.1.0
 */
export class SimState extends Schema.Class<SimState>("SimState")({
  time: Schema.Number.pipe(Schema.finite()),
  stocks: Schema.Record({
    key: Schema.String,
    value: Schema.Number.pipe(Schema.finite()),
  }),
  variables: Schema.Record({
    key: Schema.String,
    value: Schema.Number.pipe(Schema.finite()),
  }),
  units: Schema.optionalWith(SimUnits, {
    default: () =>
      new SimUnits({
        stocks: {},
        variables: {},
        rates: {},
        time: {},
      }),
  }),
}) {}

export interface ParallelSimulationTarget {
  readonly model: Model
  readonly id?: string
  readonly collectStates?: boolean
}

export interface ParallelSimulationResult {
  readonly model: Model
  readonly id?: string
  readonly final: SimState
  readonly states?: ReadonlyArray<SimState>
}

export interface ParallelSimulationOptions {
  readonly collectStates?: boolean
  readonly parallelism?: number | "unbounded"
}

/** @internal */
const initialStateFromModel = (model: Model) =>
  new SimState({
    time: model.timeConfig.start,
    stocks: Object.fromEntries(
      model.stocks.map((stock) => [stock.id, stock.initialValue] as const),
    ),
    variables: {},
    units: deriveInitialUnits(model),
  })

/** @internal */
const continueSimulation = <R>(
  solverStep: (state: SimState) => Effect.Effect<SimState, SolverError, R>,
  state: SimState,
  end: number,
): Effect.Effect<Option.Option<[SimState, SimState]>, SolverError, R> =>
  state.time >= end
    ? Effect.succeed<Option.Option<[SimState, SimState]>>(Option.none())
    : solverStep(state).pipe(
        Effect.map(
          (next): Option.Option<[SimState, SimState]> => Option.some([next, next]),
        ),
      )

/** @internal */
const unwrapLastState = (option: Option.Option<SimState>) =>
  Option.match(option, {
    onNone: () => Effect.fail(new Cause.NoSuchElementException()),
    onSome: (state) => Effect.succeed(state),
  })

/**
 * Lazily simulate a model, streaming states one timestep at a time.
 *
 * The stream emits the state at the start of each timestep. Consumers can
 * decide whether to materialise the entire run (`Stream.runCollect`) or stop
 * early for interactive scenarios. Solver errors propagate through the stream
 * so callers can handle convergence issues gracefully.
 *
 * @param model - The model to simulate
 * @returns Effect yielding a Stream of simulation states
 *
 * @since 0.1.0
 */
export const simulate = (
  model: Model,
): Effect.Effect<Stream.Stream<SimState, SolverError>, SolverError, Solver | UnitManager> =>
  Effect.gen(function* () {
    const solver = yield* Solver
    const unitManager = yield* UnitManager
    const initialState = initialStateFromModel(model)
    const step = (state: SimState) =>
      solver.step(model, state, model.timeConfig.step).pipe(
        Effect.provideService(UnitManager, unitManager),
      )
    const stream = Stream.unfoldEffect(initialState, (state) =>
      continueSimulation(step, state, model.timeConfig.end),
    )

    return model.timeConfig.start < model.timeConfig.end
      ? Stream.prepend(stream, Chunk.of(initialState))
      : stream
  })

/**
 * Eagerly materialise the entire simulation into an array of states.
 *
 * @example
 * ```ts
 * const states = await Effect.runPromise(
 *   simulateEager(model).pipe(Effect.provide(Solver.Euler))
 * )
 * console.log(states.at(-1)?.time) // => model.timeConfig.end
 * ```
 *
 * @since 0.1.0
 */
export const simulateEager = (
  model: Model,
): Effect.Effect<Array<SimState>, SolverError, Solver | UnitManager> =>
  simulate(model).pipe(
    Effect.flatMap((stream) =>
      Stream.runCollect(stream).pipe(
        Effect.map((chunk) => Chunk.toArray(chunk)),
      ),
    ),
  )

/**
 * Run the simulation and return only the final state.
 *
 * @example
 * ```ts
 * const final = await Effect.runPromise(
 *   simulateFinal(model).pipe(Effect.provide(Solver.Euler))
 * )
 * console.log(final.time) // => model.timeConfig.end
 * ```
 *
 * @since 0.1.0
 */
export const simulateFinal = (
  model: Model,
): Effect.Effect<SimState, SolverError | Cause.NoSuchElementException, Solver | UnitManager> =>
  simulate(model).pipe(
    Effect.flatMap((stream) =>
      Stream.runLast(stream).pipe(Effect.flatMap(unwrapLastState)),
    ),
  )

const resolveParallelism = (parallelism: number | "unbounded" | undefined): number | "unbounded" =>
  parallelism === undefined ? "unbounded" : parallelism

const executeParallelTarget = (
  target: ParallelSimulationTarget,
  options: ParallelSimulationOptions,
): Effect.Effect<ParallelSimulationResult, SolverError | Cause.NoSuchElementException, Solver | UnitManager> =>
  Effect.gen(function* () {
    const collectStates = target.collectStates ?? options.collectStates ?? false
    if (collectStates) {
      const states = yield* simulateEager(target.model)
      const finalState = states.at(-1)
      if (finalState) {
        return {
          model: target.model,
          final: finalState,
          ...(target.id !== undefined ? { id: target.id } : {}),
          states,
        }
      }
      const final = yield* simulateFinal(target.model)
      return {
        model: target.model,
        final,
        ...(target.id !== undefined ? { id: target.id } : {}),
        states,
      }
    }

    const final = yield* simulateFinal(target.model)
    return {
      model: target.model,
      final,
      ...(target.id !== undefined ? { id: target.id } : {}),
    }
  })

/**
 * Execute multiple simulations in parallel, returning their final (and optionally full) states.
 *
 * @since 0.1.0
 */
export const simulateParallel = (
  targets: ReadonlyArray<ParallelSimulationTarget>,
  options: ParallelSimulationOptions = {},
): Effect.Effect<ReadonlyArray<ParallelSimulationResult>, SolverError | Cause.NoSuchElementException, Solver | UnitManager> =>
  targets.length === 0
    ? Effect.succeed([])
    : Effect.forEach(targets, (target) => executeParallelTarget(target, options), {
        concurrency: resolveParallelism(options.parallelism),
      })
