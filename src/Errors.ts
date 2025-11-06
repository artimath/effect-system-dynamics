/**
 * Solver error hierarchy for Effect System Dynamics.
 *
 * Captures well-typed failure modes emitted by numerical solvers so callers can
 * pattern match on tagged errors using `Effect.catchTag`. Messages stay
 * human-readable for observability while still providing structured data for
 * programmatic handling.
 *
 * @since 0.1.0
 */

import { Data } from "effect"
import { EquationEvaluationError } from "./internal/equations/errors.js"
import { ModelId } from "./Types.js"

/**
 * Unique symbol used to tag solver-related services within the context graph.
 *
 * @since 0.1.0
 */
export const SolverTypeId = Symbol.for("@org/effect-system-dynamics/Solver")

/**
 * Raised when a solver fails to converge within tolerance at a specific time
 * step.
 *
 * @category Errors
 * @since 0.1.0
 * @example
 * ```ts
 * const error = new ConvergenceError({ model: modelId, timeStep: 42, error: 1e-3 })
 * yield* Effect.fail(error)
 * ```
 */
export class ConvergenceError extends Data.TaggedError("ConvergenceError")<{
  readonly model: ModelId
  readonly timeStep: number
  readonly error: number
}> {
  /**
   * Human-friendly message describing the failed timestep.
   */
  get message(): string {
    return `Solver failed to converge at t=${this.timeStep}: error=${this.error}`
  }
}

/**
 * Raised when a timestep (`dt`) is outside the supported bounds for a solver.
 *
 * @category Errors
 * @since 0.1.0
 * @example
 * ```ts
 * const error = new InvalidTimeStepError({ dt: 0, min: 1e-6, max: 1 })
 * yield* Effect.fail(error)
 * ```
 */
export class InvalidTimeStepError extends Data.TaggedError("InvalidTimeStepError")<{
  readonly dt: number
  readonly min: number
  readonly max: number
}> {
  /**
   * Human-friendly message describing the invalid timestep.
   */
  get message(): string {
    return `Invalid timestep ${this.dt}: must be between ${this.min} and ${this.max}`
  }
}

/**
 * Union of all solver-related error types.
 *
 * @category Errors
 * @since 0.1.0
 */
export type SolverError = ConvergenceError | InvalidTimeStepError | EquationEvaluationError
