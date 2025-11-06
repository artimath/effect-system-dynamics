import { Cause, Context, Effect, Layer, Schema } from "effect";
import { Model } from "./Model.js";
import { ScenarioId, ModelId } from "./Types.js";
import { SimState } from "./Simulation.js";
import { Solver } from "./Solver.js";
import { UnitManager } from "./Units.js";
import { SolverError } from "./Errors.js";
declare const ScenarioDefinition_base: Schema.Class<ScenarioDefinition, {
    id: Schema.brand<typeof Schema.UUID, "ScenarioId">;
    name: typeof Schema.NonEmptyTrimmedString;
    baseModelId: Schema.brand<typeof Schema.UUID, "ModelId">;
    overrides: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    description: Schema.optional<typeof Schema.String>;
}, Schema.Struct.Encoded<{
    id: Schema.brand<typeof Schema.UUID, "ScenarioId">;
    name: typeof Schema.NonEmptyTrimmedString;
    baseModelId: Schema.brand<typeof Schema.UUID, "ModelId">;
    overrides: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    description: Schema.optional<typeof Schema.String>;
}>, never, {
    readonly id: string & import("effect/Brand").Brand<"ScenarioId">;
} & {
    readonly name: string;
} & {
    readonly description?: string | undefined;
} & {
    readonly baseModelId: string & import("effect/Brand").Brand<"ModelId">;
} & {
    readonly overrides: {
        readonly [x: string]: number;
    };
}, {}, {}>;
/**
 * Scenario definition describing a set of parameter overrides applied to a base model.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export declare class ScenarioDefinition extends ScenarioDefinition_base {
}
declare const ScenarioSummary_base: Schema.Class<ScenarioSummary, {
    scenarioId: Schema.brand<typeof Schema.UUID, "ScenarioId">;
    name: typeof Schema.NonEmptyTrimmedString;
    finalTime: typeof Schema.Number;
    finalStocks: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    finalVariables: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    deltaStocks: Schema.optional<Schema.Record$<typeof Schema.String, typeof Schema.Number>>;
    deltaVariables: Schema.optional<Schema.Record$<typeof Schema.String, typeof Schema.Number>>;
}, Schema.Struct.Encoded<{
    scenarioId: Schema.brand<typeof Schema.UUID, "ScenarioId">;
    name: typeof Schema.NonEmptyTrimmedString;
    finalTime: typeof Schema.Number;
    finalStocks: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    finalVariables: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    deltaStocks: Schema.optional<Schema.Record$<typeof Schema.String, typeof Schema.Number>>;
    deltaVariables: Schema.optional<Schema.Record$<typeof Schema.String, typeof Schema.Number>>;
}>, never, {
    readonly name: string;
} & {
    readonly finalTime: number;
} & {
    readonly scenarioId: string & import("effect/Brand").Brand<"ScenarioId">;
} & {
    readonly finalStocks: {
        readonly [x: string]: number;
    };
} & {
    readonly finalVariables: {
        readonly [x: string]: number;
    };
} & {
    readonly deltaStocks?: {
        readonly [x: string]: number;
    } | undefined;
} & {
    readonly deltaVariables?: {
        readonly [x: string]: number;
    } | undefined;
}, {}, {}>;
/**
 * Summary information for a scenario run.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export declare class ScenarioSummary extends ScenarioSummary_base {
}
declare const ScenarioComparison_base: Schema.Class<ScenarioComparison, {
    baseline: typeof ScenarioSummary;
    scenarios: Schema.Array$<typeof ScenarioSummary>;
}, Schema.Struct.Encoded<{
    baseline: typeof ScenarioSummary;
    scenarios: Schema.Array$<typeof ScenarioSummary>;
}>, never, {
    readonly baseline: ScenarioSummary;
} & {
    readonly scenarios: readonly ScenarioSummary[];
}, {}, {}>;
/**
 * Comparison payload between a baseline run and scenario variants.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export declare class ScenarioComparison extends ScenarioComparison_base {
}
declare const MonteCarloPercentile_base: Schema.Class<MonteCarloPercentile, {
    percentile: Schema.filter<Schema.filter<typeof Schema.Number>>;
    value: typeof Schema.Number;
}, Schema.Struct.Encoded<{
    percentile: Schema.filter<Schema.filter<typeof Schema.Number>>;
    value: typeof Schema.Number;
}>, never, {
    readonly value: number;
} & {
    readonly percentile: number;
}, {}, {}>;
/**
 * Percentile entry generated from Monte Carlo sampling.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export declare class MonteCarloPercentile extends MonteCarloPercentile_base {
}
declare const MonteCarloMetricSummary_base: Schema.Class<MonteCarloMetricSummary, {
    name: typeof Schema.NonEmptyTrimmedString;
    mean: typeof Schema.Number;
    variance: typeof Schema.Number;
    min: typeof Schema.Number;
    max: typeof Schema.Number;
    percentiles: Schema.Array$<typeof MonteCarloPercentile>;
}, Schema.Struct.Encoded<{
    name: typeof Schema.NonEmptyTrimmedString;
    mean: typeof Schema.Number;
    variance: typeof Schema.Number;
    min: typeof Schema.Number;
    max: typeof Schema.Number;
    percentiles: Schema.Array$<typeof MonteCarloPercentile>;
}>, never, {
    readonly name: string;
} & {
    readonly max: number;
} & {
    readonly min: number;
} & {
    readonly mean: number;
} & {
    readonly variance: number;
} & {
    readonly percentiles: readonly MonteCarloPercentile[];
}, {}, {}>;
/**
 * Aggregated statistics for a single metric across Monte Carlo samples.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export declare class MonteCarloMetricSummary extends MonteCarloMetricSummary_base {
}
declare const MonteCarloResult_base: Schema.Class<MonteCarloResult, {
    iterations: Schema.filter<typeof Schema.Number>;
    metrics: Schema.Array$<typeof MonteCarloMetricSummary>;
}, Schema.Struct.Encoded<{
    iterations: Schema.filter<typeof Schema.Number>;
    metrics: Schema.Array$<typeof MonteCarloMetricSummary>;
}>, never, {
    readonly iterations: number;
} & {
    readonly metrics: readonly MonteCarloMetricSummary[];
}, {}, {}>;
/**
 * Result payload returned by Monte Carlo runs.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export declare class MonteCarloResult extends MonteCarloResult_base {
}
/**
 * Result returned from executing a scenario.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export interface ScenarioRun {
    readonly definition: ScenarioDefinition;
    readonly model: Model;
    readonly final: SimState;
    readonly states?: ReadonlyArray<SimState>;
}
/**
 * Options controlling scenario execution.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export interface ScenarioRunOptions {
    readonly collectStates?: boolean;
    readonly parallelism?: number | "unbounded";
}
/**
 * Input supplied to a Monte Carlo parameter sampler.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export interface MonteCarloSampleContext {
    readonly iteration: number;
    readonly baseline: number;
    readonly random: () => number;
}
/**
 * Sampler invoked to draw a value for a parameter override.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export type MonteCarloSampler = (context: MonteCarloSampleContext) => number;
/**
 * Parameter override definition used for Monte Carlo sampling.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export interface MonteCarloParameter {
    readonly name: string;
    readonly sampler: MonteCarloSampler;
}
/**
 * Options describing a Monte Carlo experiment.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export type MonteCarloOptions = ScenarioRunOptions & {
    readonly iterations: number;
    readonly parameters: ReadonlyArray<MonteCarloParameter>;
    readonly metrics: ReadonlyArray<string>;
    readonly seed?: number;
    readonly percentiles?: ReadonlyArray<number>;
    readonly concurrency?: number | "unbounded";
};
declare const ScenarioOverrideNotFoundError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => Cause.YieldableError & {
    readonly _tag: "ScenarioOverrideNotFoundError";
} & Readonly<A>;
/**
 * Raised when scenario overrides reference unknown parameters.
 *
 * @category Errors
 * @since 0.1.0
 */
export declare class ScenarioOverrideNotFoundError extends ScenarioOverrideNotFoundError_base<{
    readonly scenarioId?: ScenarioId;
    readonly targets: ReadonlyArray<string>;
}> {
    get message(): string;
}
declare const ScenarioUnsupportedOverrideError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => Cause.YieldableError & {
    readonly _tag: "ScenarioUnsupportedOverrideError";
} & Readonly<A>;
/**
 * Raised when an override targets an unsupported parameter (e.g., auxiliary variable).
 *
 * @category Errors
 * @since 0.1.0
 */
export declare class ScenarioUnsupportedOverrideError extends ScenarioUnsupportedOverrideError_base<{
    readonly scenarioId?: ScenarioId;
    readonly target: string;
    readonly reason: string;
}> {
    get message(): string;
}
declare const ScenarioMetricNotFoundError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => Cause.YieldableError & {
    readonly _tag: "ScenarioMetricNotFoundError";
} & Readonly<A>;
/**
 * Raised when a requested metric is not present in the simulation output.
 *
 * @category Errors
 * @since 0.1.0
 */
export declare class ScenarioMetricNotFoundError extends ScenarioMetricNotFoundError_base<{
    readonly name: string;
}> {
    get message(): string;
}
declare const MonteCarloConfigurationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => Cause.YieldableError & {
    readonly _tag: "MonteCarloConfigurationError";
} & Readonly<A>;
/**
 * Raised when Monte Carlo configuration is invalid.
 */
export declare class MonteCarloConfigurationError extends MonteCarloConfigurationError_base<{
    readonly reason: string;
}> {
    get message(): string;
}
declare const ScenarioModelMismatchError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => Cause.YieldableError & {
    readonly _tag: "ScenarioModelMismatchError";
} & Readonly<A>;
/**
 * Raised when a scenario references a different base model than the one provided.
 *
 * @category Errors
 * @since 0.1.0
 */
export declare class ScenarioModelMismatchError extends ScenarioModelMismatchError_base<{
    readonly scenarioId: ScenarioId;
    readonly expected: ModelId;
    readonly actual: ModelId;
}> {
    get message(): string;
}
/**
 * Union type capturing scenario-related failures.
 *
 * @category Errors
 * @since 0.1.0
 */
export type ScenarioError = ScenarioOverrideNotFoundError | ScenarioUnsupportedOverrideError | ScenarioMetricNotFoundError | ScenarioModelMismatchError | MonteCarloConfigurationError;
type ScenarioRuntimeError = ScenarioError | SolverError | Cause.NoSuchElementException;
export interface ScenarioServiceHandle {
    readonly branch: (model: Model, definition: ScenarioDefinition) => Effect.Effect<{
        readonly definition: ScenarioDefinition;
        readonly model: Model;
    }, ScenarioError>;
    readonly run: (model: Model, definition: ScenarioDefinition, options?: ScenarioRunOptions) => Effect.Effect<ScenarioRun, ScenarioRuntimeError, Solver | UnitManager>;
    readonly compare: (model: Model, definitions: ReadonlyArray<ScenarioDefinition>, options?: ScenarioRunOptions) => Effect.Effect<ScenarioComparison, ScenarioRuntimeError, Solver | UnitManager>;
    readonly monteCarlo: (model: Model, baseDefinition: ScenarioDefinition, config: MonteCarloOptions) => Effect.Effect<MonteCarloResult, ScenarioRuntimeError, Solver | UnitManager>;
}
declare const ScenarioService_base: Context.TagClass<ScenarioService, "@org/effect-system-dynamics/ScenarioService", ScenarioServiceHandle>;
/**
 * Scenario service tag for dependency injection.
 *
 * @category Services
 * @since 0.1.0
 */
export declare class ScenarioService extends ScenarioService_base {
    /**
     * Default layer providing the in-memory scenario service implementation.
     */
    static readonly layer: Layer.Layer<ScenarioService, never, never>;
}
declare const SensitivityResult_base: Schema.Class<SensitivityResult, {
    parameter: typeof Schema.String;
    impact: typeof Schema.Number;
    direction: Schema.Literal<["positive", "negative", "neutral"]>;
    confidence: typeof Schema.Number;
}, Schema.Struct.Encoded<{
    parameter: typeof Schema.String;
    impact: typeof Schema.Number;
    direction: Schema.Literal<["positive", "negative", "neutral"]>;
    confidence: typeof Schema.Number;
}>, never, {
    readonly parameter: string;
} & {
    readonly impact: number;
} & {
    readonly confidence: number;
} & {
    readonly direction: "positive" | "negative" | "neutral";
}, {}, {}>;
/**
 * Sensitivity analysis result capturing the impact of a parameter tweak.
 *
 * @category Sensitivity
 * @since 0.1.0
 */
export declare class SensitivityResult extends SensitivityResult_base {
}
/**
 * Sensitivity analysis specific errors.
 *
 * @category Errors
 * @since 0.1.0
 */
export type SensitivityError = ScenarioRuntimeError;
export interface SensitivityServiceHandle {
    readonly analyze: (model: Model, target: string, parameters: ReadonlyArray<string>, variationPercent: number, options?: ScenarioRunOptions) => Effect.Effect<ReadonlyArray<SensitivityResult>, SensitivityError, Solver | UnitManager>;
}
declare const SensitivityService_base: Context.TagClass<SensitivityService, "@org/effect-system-dynamics/SensitivityService", SensitivityServiceHandle>;
/**
 * Sensitivity service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export declare class SensitivityService extends SensitivityService_base {
    static layer: Layer.Layer<SensitivityService, never, ScenarioService>;
}
declare const Objective_base: Schema.Class<Objective, {
    target: typeof Schema.String;
    direction: Schema.Literal<["maximize", "minimize"]>;
    atTime: typeof Schema.Number;
}, Schema.Struct.Encoded<{
    target: typeof Schema.String;
    direction: Schema.Literal<["maximize", "minimize"]>;
    atTime: typeof Schema.Number;
}>, never, {
    readonly target: string;
} & {
    readonly direction: "maximize" | "minimize";
} & {
    readonly atTime: number;
}, {}, {}>;
/**
 * Optimization objective definition.
 *
 * @category Optimization
 * @since 0.1.0
 */
export declare class Objective extends Objective_base {
}
declare const Constraint_base: Schema.Class<Constraint, {
    parameter: typeof Schema.String;
    min: typeof Schema.Number;
    max: typeof Schema.Number;
}, Schema.Struct.Encoded<{
    parameter: typeof Schema.String;
    min: typeof Schema.Number;
    max: typeof Schema.Number;
}>, never, {
    readonly max: number;
} & {
    readonly min: number;
} & {
    readonly parameter: string;
}, {}, {}>;
/**
 * Parameter constraint used during optimization.
 *
 * @category Optimization
 * @since 0.1.0
 */
export declare class Constraint extends Constraint_base {
}
declare const OptimizationResult_base: Schema.Class<OptimizationResult, {
    objective: typeof Objective;
    bestParameters: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    value: typeof Schema.Number;
    iterations: typeof Schema.Number;
    strategy: typeof Schema.String;
}, Schema.Struct.Encoded<{
    objective: typeof Objective;
    bestParameters: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    value: typeof Schema.Number;
    iterations: typeof Schema.Number;
    strategy: typeof Schema.String;
}>, never, {
    readonly value: number;
} & {
    readonly iterations: number;
} & {
    readonly objective: Objective;
} & {
    readonly strategy: string;
} & {
    readonly bestParameters: {
        readonly [x: string]: number;
    };
}, {}, {}>;
/**
 * Result of the optimization pass.
 *
 * @category Optimization
 * @since 0.1.0
 */
export declare class OptimizationResult extends OptimizationResult_base {
}
/**
 * Errors that can surface during optimization.
 *
 * @category Errors
 * @since 0.1.0
 */
export type OptimizationError = ScenarioRuntimeError;
export interface OptimizationOptions {
    readonly stepsPerParameter?: number;
    readonly iterations?: number;
    readonly strategy?: OptimizationStrategy | "grid" | "random";
    readonly scenarioOptions?: ScenarioRunOptions;
}
export interface OptimizationContext {
    readonly model: Model;
    readonly objective: Objective;
    readonly constraints: ReadonlyArray<Constraint>;
    readonly scenarioService: ScenarioServiceHandle;
    readonly options: OptimizationOptions;
}
export interface OptimizationStrategyResult {
    readonly bestParameters: Record<string, number>;
    readonly bestValue: number;
    readonly iterations: number;
}
export interface OptimizationStrategy {
    readonly name: string;
    readonly optimize: (context: OptimizationContext) => Effect.Effect<OptimizationStrategyResult, OptimizationError, Solver | UnitManager>;
}
export interface OptimizerServiceHandle {
    readonly optimize: (model: Model, objective: Objective, constraints: ReadonlyArray<Constraint>, options?: OptimizationOptions) => Effect.Effect<OptimizationResult, OptimizationError, Solver | UnitManager>;
}
declare const OptimizerService_base: Context.TagClass<OptimizerService, "@org/effect-system-dynamics/OptimizerService", OptimizerServiceHandle>;
/**
 * Optimizer service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export declare class OptimizerService extends OptimizerService_base {
    static layer: Layer.Layer<OptimizerService, never, ScenarioService>;
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
export declare const ScenarioServicesLayer: Layer.Layer<ScenarioService | SensitivityService | OptimizerService, never, never>;
export {};
//# sourceMappingURL=Scenarios.d.ts.map