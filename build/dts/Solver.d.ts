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
import { Context, Effect, Layer } from "effect";
import { ConvergenceError, InvalidTimeStepError } from "./Errors.js";
import { Model } from "./Model.js";
import { SimState } from "./Simulation.js";
import { EquationEvaluationError } from "./internal/equations/errors.js";
import { UnitManager } from "./Units.js";
export interface AdaptiveSolverOptions {
    readonly initialStep?: number;
    readonly minStep?: number;
    readonly maxStep?: number;
    readonly safetyFactor?: number;
    readonly growthLimit?: number;
    readonly shrinkLimit?: number;
    readonly absoluteTolerance?: number | Record<string, number>;
    readonly relativeTolerance?: number | Record<string, number>;
    readonly maxAttemptsPerStep?: number;
}
declare const Solver_base: Context.TagClass<Solver, string, {
    readonly name: string;
    readonly step: (model: Model, state: SimState, dt: number) => Effect.Effect<SimState, ConvergenceError | InvalidTimeStepError | EquationEvaluationError, UnitManager>;
}>;
/**
 * Context tag describing the solver interface contract.
 *
 * @category Services
 * @since 0.1.0
 */
export declare class Solver extends Solver_base {
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
    static readonly Euler: Layer.Layer<Solver, never, never>;
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
    static readonly RK4: Layer.Layer<Solver, never, never>;
    static Adaptive(options?: AdaptiveSolverOptions): Layer.Layer<Solver, never, never>;
}
export {};
//# sourceMappingURL=Solver.d.ts.map