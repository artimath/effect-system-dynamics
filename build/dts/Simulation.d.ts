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
import { Cause, Effect, Schema, Stream } from "effect";
import { SolverError } from "./Errors.js";
import { Model } from "./Model.js";
import { Solver } from "./Solver.js";
import { UnitManager } from "./Units.js";
import { UnitMap } from "./internal/equations/Quantity.js";
declare const SimUnits_base: Schema.Class<SimUnits, {
    stocks: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    variables: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    rates: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    time: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
}, Schema.Struct.Encoded<{
    stocks: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    variables: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    rates: Schema.Record$<typeof Schema.String, Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>>;
    time: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
}>, never, {
    readonly stocks: {
        readonly [x: string]: {
            readonly [x: string]: number;
        };
    };
} & {
    readonly variables: {
        readonly [x: string]: {
            readonly [x: string]: number;
        };
    };
} & {
    readonly time: {
        readonly [x: string]: number;
    };
} & {
    readonly rates: {
        readonly [x: string]: {
            readonly [x: string]: number;
        };
    };
}, {}, {}>;
export declare class SimUnits extends SimUnits_base {
}
export type DynamicsSnapshot = {
    readonly variables: Record<string, number>;
    readonly variableUnits: Record<string, UnitMap>;
    readonly rateUnits: Record<string, UnitMap>;
    readonly stockUnits: Record<string, UnitMap>;
    readonly timeUnit: UnitMap;
};
declare const SimState_base: Schema.Class<SimState, {
    time: Schema.filter<typeof Schema.Number>;
    stocks: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
    variables: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
    units: Schema.optionalWith<typeof SimUnits, {
        default: () => SimUnits;
    }>;
}, Schema.Struct.Encoded<{
    time: Schema.filter<typeof Schema.Number>;
    stocks: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
    variables: Schema.Record$<typeof Schema.String, Schema.filter<typeof Schema.Number>>;
    units: Schema.optionalWith<typeof SimUnits, {
        default: () => SimUnits;
    }>;
}>, never, {
    readonly units?: SimUnits | undefined;
} & {
    readonly stocks: {
        readonly [x: string]: number;
    };
} & {
    readonly variables: {
        readonly [x: string]: number;
    };
} & {
    readonly time: number;
}, {}, {}>;
/**
 * Immutable snapshot of a simulation at a single timestep.
 *
 * @category Simulation
 * @since 0.1.0
 */
export declare class SimState extends SimState_base {
}
export interface ParallelSimulationTarget {
    readonly model: Model;
    readonly id?: string;
    readonly collectStates?: boolean;
}
export interface ParallelSimulationResult {
    readonly model: Model;
    readonly id?: string;
    readonly final: SimState;
    readonly states?: ReadonlyArray<SimState>;
}
export interface ParallelSimulationOptions {
    readonly collectStates?: boolean;
    readonly parallelism?: number | "unbounded";
}
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
export declare const simulate: (model: Model) => Effect.Effect<Stream.Stream<SimState, SolverError>, SolverError, Solver | UnitManager>;
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
export declare const simulateEager: (model: Model) => Effect.Effect<Array<SimState>, SolverError, Solver | UnitManager>;
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
export declare const simulateFinal: (model: Model) => Effect.Effect<SimState, SolverError | Cause.NoSuchElementException, Solver | UnitManager>;
/**
 * Execute multiple simulations in parallel, returning their final (and optionally full) states.
 *
 * @since 0.1.0
 */
export declare const simulateParallel: (targets: ReadonlyArray<ParallelSimulationTarget>, options?: ParallelSimulationOptions) => Effect.Effect<ReadonlyArray<ParallelSimulationResult>, SolverError | Cause.NoSuchElementException, Solver | UnitManager>;
export {};
//# sourceMappingURL=Simulation.d.ts.map