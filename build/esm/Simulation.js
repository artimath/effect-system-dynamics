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
import { Cause, Chunk, Effect, Option, Schema, Stream } from "effect";
import { Solver } from "./Solver.js";
import { UnitManager } from "./Units.js";
import { EquationEvaluationError, EquationParseError } from "./internal/equations/errors.js";
import { parseUnitsLiteral } from "./internal/equations/EquationEngine.js";
import { divideUnits } from "./internal/equations/Quantity.js";
const UnitExponent = Schema.Number.pipe(Schema.finite());
const UnitMapSchema = Schema.Record({
    key: Schema.String,
    value: UnitExponent,
});
export class SimUnits extends Schema.Class("SimUnits")({
    stocks: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
    variables: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
    rates: Schema.Record({ key: Schema.String, value: UnitMapSchema }),
    time: UnitMapSchema,
}) {
}
const cloneUnitMap = (units) => ({ ...units });
const DEFAULT_TIME_UNIT_LABEL = "tick";
const defaultTimeUnit = () => ({ [DEFAULT_TIME_UNIT_LABEL]: 1 });
const parseUnitsOrThrow = (units, context) => {
    if (!units || units.trim().length === 0) {
        return Object.create(null);
    }
    try {
        return parseUnitsLiteral(units);
    }
    catch (error) {
        if (error instanceof EquationParseError) {
            throw new EquationEvaluationError({
                expression: context,
                problem: error.problem,
            });
        }
        if (error instanceof EquationEvaluationError) {
            throw new EquationEvaluationError({
                expression: context,
                problem: error.problem,
            });
        }
        throw new EquationEvaluationError({
            expression: context,
            problem: error instanceof Error ? error.message : String(error),
        });
    }
};
const getModelTimeUnit = (model) => {
    const config = model.timeConfig;
    const configured = config.units;
    if (configured && configured.trim().length > 0) {
        return parseUnitsOrThrow(configured, "Time configuration units");
    }
    return defaultTimeUnit();
};
const deriveInitialUnits = (model) => {
    const timeUnit = getModelTimeUnit(model);
    const stocks = Object.create(null);
    const rates = Object.create(null);
    for (const stock of model.stocks) {
        const units = parseUnitsOrThrow(stock.units, `Stock "${stock.name}" units`);
        stocks[stock.id] = cloneUnitMap(units);
        rates[stock.id] = divideUnits(units, timeUnit);
    }
    return new SimUnits({
        stocks,
        variables: {},
        rates,
        time: cloneUnitMap(timeUnit),
    });
};
/**
 * Immutable snapshot of a simulation at a single timestep.
 *
 * @category Simulation
 * @since 0.1.0
 */
export class SimState extends Schema.Class("SimState")({
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
        default: () => new SimUnits({
            stocks: {},
            variables: {},
            rates: {},
            time: {},
        }),
    }),
}) {
}
/** @internal */
const initialStateFromModel = (model) => new SimState({
    time: model.timeConfig.start,
    stocks: Object.fromEntries(model.stocks.map((stock) => [stock.id, stock.initialValue])),
    variables: {},
    units: deriveInitialUnits(model),
});
/** @internal */
const continueSimulation = (solverStep, state, end) => state.time >= end
    ? Effect.succeed(Option.none())
    : solverStep(state).pipe(Effect.map((next) => Option.some([next, next])));
/** @internal */
const unwrapLastState = (option) => Option.match(option, {
    onNone: () => Effect.fail(new Cause.NoSuchElementException()),
    onSome: (state) => Effect.succeed(state),
});
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
export const simulate = (model) => Effect.gen(function* () {
    const solver = yield* Solver;
    const unitManager = yield* UnitManager;
    const initialState = initialStateFromModel(model);
    const step = (state) => solver.step(model, state, model.timeConfig.step).pipe(Effect.provideService(UnitManager, unitManager));
    const stream = Stream.unfoldEffect(initialState, (state) => continueSimulation(step, state, model.timeConfig.end));
    return model.timeConfig.start < model.timeConfig.end
        ? Stream.prepend(stream, Chunk.of(initialState))
        : stream;
});
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
export const simulateEager = (model) => simulate(model).pipe(Effect.flatMap((stream) => Stream.runCollect(stream).pipe(Effect.map((chunk) => Chunk.toArray(chunk)))));
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
export const simulateFinal = (model) => simulate(model).pipe(Effect.flatMap((stream) => Stream.runLast(stream).pipe(Effect.flatMap(unwrapLastState))));
const resolveParallelism = (parallelism) => parallelism === undefined ? "unbounded" : parallelism;
const executeParallelTarget = (target, options) => Effect.gen(function* () {
    const collectStates = target.collectStates ?? options.collectStates ?? false;
    if (collectStates) {
        const states = yield* simulateEager(target.model);
        const finalState = states.at(-1);
        if (finalState) {
            return {
                model: target.model,
                final: finalState,
                ...(target.id !== undefined ? { id: target.id } : {}),
                states,
            };
        }
        const final = yield* simulateFinal(target.model);
        return {
            model: target.model,
            final,
            ...(target.id !== undefined ? { id: target.id } : {}),
            states,
        };
    }
    const final = yield* simulateFinal(target.model);
    return {
        model: target.model,
        final,
        ...(target.id !== undefined ? { id: target.id } : {}),
    };
});
/**
 * Execute multiple simulations in parallel, returning their final (and optionally full) states.
 *
 * @since 0.1.0
 */
export const simulateParallel = (targets, options = {}) => targets.length === 0
    ? Effect.succeed([])
    : Effect.forEach(targets, (target) => executeParallelTarget(target, options), {
        concurrency: resolveParallelism(options.parallelism),
    });
//# sourceMappingURL=Simulation.js.map