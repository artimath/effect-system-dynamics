/**
 * Core Domain Schemas for System Dynamics
 *
 * This module defines the fundamental building blocks of system dynamics models:
 * - Stock: An accumulator that changes over time
 * - Flow: A rate that changes stock levels
 * - Variable: An auxiliary computation or constant
 * - TimeConfig: Simulation time configuration
 * - Model: Complete system dynamics model
 *
 * @since 0.1.0
 */
import { Schema } from "effect";
declare const Stock_base: Schema.Class<Stock, {
    id: Schema.brand<typeof Schema.UUID, "StockId">;
    name: typeof Schema.NonEmptyTrimmedString;
    initialValue: Schema.filter<typeof Schema.Number>;
    units: Schema.optional<typeof Schema.String>;
    description: Schema.optional<typeof Schema.String>;
}, Schema.Struct.Encoded<{
    id: Schema.brand<typeof Schema.UUID, "StockId">;
    name: typeof Schema.NonEmptyTrimmedString;
    initialValue: Schema.filter<typeof Schema.Number>;
    units: Schema.optional<typeof Schema.String>;
    description: Schema.optional<typeof Schema.String>;
}>, never, {
    readonly id: string & import("effect/Brand").Brand<"StockId">;
} & {
    readonly name: string;
} & {
    readonly initialValue: number;
} & {
    readonly units?: string | undefined;
} & {
    readonly description?: string | undefined;
}, {}, {}>;
/**
 * Stock: An accumulator in a system dynamics model.
 *
 * Stocks represent quantities that accumulate over time (e.g., population, inventory, cash balance).
 * They are changed by flows and can be measured at any point in time.
 *
 * @since 0.1.0
 * @category Models
 * @example
 * ```typescript
 * const population = new Stock({
 *   id: Schema.decodeSync(StockId)("550e8400-e29b-41d4-a716-446655440000"),
 *   name: "Population",
 *   initialValue: 1000,
 *   units: "people",
 *   description: "Total population in the region"
 * })
 * ```
 */
export declare class Stock extends Stock_base {
}
declare const Flow_base: Schema.Class<Flow, {
    id: Schema.brand<typeof Schema.UUID, "FlowId">;
    name: typeof Schema.NonEmptyTrimmedString;
    source: Schema.optional<Schema.brand<typeof Schema.UUID, "StockId">>;
    target: Schema.optional<Schema.brand<typeof Schema.UUID, "StockId">>;
    rateEquation: typeof Schema.String;
    units: Schema.optional<typeof Schema.String>;
}, Schema.Struct.Encoded<{
    id: Schema.brand<typeof Schema.UUID, "FlowId">;
    name: typeof Schema.NonEmptyTrimmedString;
    source: Schema.optional<Schema.brand<typeof Schema.UUID, "StockId">>;
    target: Schema.optional<Schema.brand<typeof Schema.UUID, "StockId">>;
    rateEquation: typeof Schema.String;
    units: Schema.optional<typeof Schema.String>;
}>, never, {
    readonly id: string & import("effect/Brand").Brand<"FlowId">;
} & {
    readonly name: string;
} & {
    readonly units?: string | undefined;
} & {
    readonly rateEquation: string;
} & {
    readonly source?: (string & import("effect/Brand").Brand<"StockId">) | undefined;
} & {
    readonly target?: (string & import("effect/Brand").Brand<"StockId">) | undefined;
}, {}, {}>;
/**
 * Flow: A rate of change between stocks in a system dynamics model.
 *
 * Flows represent rates that change stock levels over time (e.g., birth rate, sales, revenue).
 * Flows can have a source stock (decreases it) and a target stock (increases it).
 * Cloud sources/sinks are represented by optional source/target.
 *
 * @since 0.1.0
 * @category Models
 * @example
 * ```typescript
 * const births = new Flow({
 *   id: Schema.decodeSync(FlowId)("660e8400-e29b-41d4-a716-446655440001"),
 *   name: "Births",
 *   source: Option.none(), // cloud source
 *   target: populationId,
 *   rateEquation: "0.01 * [Population]", // 1% birth rate
 *   units: "people/year"
 * })
 * ```
 */
export declare class Flow extends Flow_base {
}
declare const Variable_base: Schema.Class<Variable, {
    id: Schema.brand<typeof Schema.UUID, "VariableId">;
    name: typeof Schema.NonEmptyTrimmedString;
    equation: typeof Schema.String;
    type: Schema.Literal<["auxiliary", "constant"]>;
    value: Schema.optional<typeof Schema.Number>;
}, Schema.Struct.Encoded<{
    id: Schema.brand<typeof Schema.UUID, "VariableId">;
    name: typeof Schema.NonEmptyTrimmedString;
    equation: typeof Schema.String;
    type: Schema.Literal<["auxiliary", "constant"]>;
    value: Schema.optional<typeof Schema.Number>;
}>, never, {
    readonly id: string & import("effect/Brand").Brand<"VariableId">;
} & {
    readonly name: string;
} & {
    readonly equation: string;
} & {
    readonly type: "auxiliary" | "constant";
} & {
    readonly value?: number | undefined;
}, {}, {}>;
/**
 * Variable: An auxiliary computation or constant in a system dynamics model.
 *
 * Variables represent intermediate calculations (auxiliaries) or fixed parameters (constants).
 * Auxiliaries are computed from equations, while constants have fixed values.
 *
 * @since 0.1.0
 * @category Models
 * @example
 * ```typescript
 * // Auxiliary variable
 * const growthRate = new Variable({
 *   id: Schema.decodeSync(VariableId)("770e8400-e29b-41d4-a716-446655440002"),
 *   name: "Growth Rate",
 *   equation: "0.01 * (1 - [Population] / [Carrying Capacity])",
 *   type: "auxiliary"
 * })
 *
 * // Constant
 * const carryingCapacity = new Variable({
 *   id: Schema.decodeSync(VariableId)("880e8400-e29b-41d4-a716-446655440003"),
 *   name: "Carrying Capacity",
 *   equation: "",
 *   type: "constant",
 *   value: 10000
 * })
 * ```
 */
export declare class Variable extends Variable_base {
}
declare const TimeConfig_base: Schema.Class<TimeConfig, {
    start: Schema.filter<typeof Schema.Number>;
    end: Schema.filter<Schema.filter<typeof Schema.Number>>;
    step: Schema.filter<typeof Schema.Number>;
}, Schema.Struct.Encoded<{
    start: Schema.filter<typeof Schema.Number>;
    end: Schema.filter<Schema.filter<typeof Schema.Number>>;
    step: Schema.filter<typeof Schema.Number>;
}>, never, {
    readonly start: number;
} & {
    readonly end: number;
} & {
    readonly step: number;
}, {}, {}>;
/**
 * TimeConfig: Configuration for simulation time bounds and step size.
 *
 * Defines the start time, end time, and timestep (dt) for numerical integration.
 * The step size affects accuracy (smaller = more accurate) and performance (smaller = slower).
 *
 * @since 0.1.0
 * @category Models
 * @example
 * ```typescript
 * const timeConfig = new TimeConfig({
 *   start: 0,
 *   end: 100,
 *   step: 0.25  // timestep dt = 0.25
 * })
 * ```
 */
export declare class TimeConfig extends TimeConfig_base {
}
declare const Model_base: Schema.Class<Model, {
    id: Schema.brand<typeof Schema.UUID, "ModelId">;
    name: typeof Schema.NonEmptyTrimmedString;
    stocks: Schema.Array$<typeof Stock>;
    flows: Schema.Array$<typeof Flow>;
    variables: Schema.Array$<typeof Variable>;
    timeConfig: typeof TimeConfig;
}, Schema.Struct.Encoded<{
    id: Schema.brand<typeof Schema.UUID, "ModelId">;
    name: typeof Schema.NonEmptyTrimmedString;
    stocks: Schema.Array$<typeof Stock>;
    flows: Schema.Array$<typeof Flow>;
    variables: Schema.Array$<typeof Variable>;
    timeConfig: typeof TimeConfig;
}>, never, {
    readonly id: string & import("effect/Brand").Brand<"ModelId">;
} & {
    readonly name: string;
} & {
    readonly timeConfig: TimeConfig;
} & {
    readonly stocks: readonly Stock[];
} & {
    readonly flows: readonly Flow[];
} & {
    readonly variables: readonly Variable[];
}, {}, {}>;
/**
 * Model: A complete system dynamics model.
 *
 * Combines stocks, flows, variables, and time configuration into a runnable simulation.
 * Models can be validated via Schema.decode and passed to simulation functions.
 *
 * @since 0.1.0
 * @category Models
 * @example
 * ```typescript
 * const populationModel = new Model({
 *   id: Schema.decodeSync(ModelId)("550e8400-e29b-41d4-a716-446655440000"),
 *   name: "Population Growth Model",
 *   stocks: [populationStock],
 *   flows: [birthsFlow, deathsFlow],
 *   variables: [growthRateVariable],
 *   timeConfig: new TimeConfig({ start: 0, end: 100, step: 1 })
 * })
 * ```
 */
export declare class Model extends Model_base {
}
export {};
//# sourceMappingURL=Model.d.ts.map