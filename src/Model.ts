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

import { Schema } from "effect"
import { StockId, FlowId, VariableId, ModelId } from "./Types.js"

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
export class Stock extends Schema.Class<Stock>("Stock")({
  id: StockId,
  name: Schema.NonEmptyTrimmedString,
  initialValue: Schema.Number.pipe(Schema.nonNaN()),
  units: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
}) {}

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
export class Flow extends Schema.Class<Flow>("Flow")({
  id: FlowId,
  name: Schema.NonEmptyTrimmedString,
  source: Schema.optional(StockId), // undefined = cloud source
  target: Schema.optional(StockId), // undefined = cloud sink
  rateEquation: Schema.String, // Will use Equation DSL later
  units: Schema.optional(Schema.String),
}) {}

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
export class Variable extends Schema.Class<Variable>("Variable")({
  id: VariableId,
  name: Schema.NonEmptyTrimmedString,
  equation: Schema.String,
  type: Schema.Literal("auxiliary", "constant"),
  value: Schema.optional(Schema.Number), // Only for constants
}) {}

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
export class TimeConfig extends Schema.Class<TimeConfig>("TimeConfig")({
  start: Schema.Number.pipe(Schema.nonNaN()),
  end: Schema.Number.pipe(Schema.nonNaN(), Schema.greaterThan(0)),
  step: Schema.Number.pipe(Schema.greaterThan(0)),
}) {}

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
export class Model extends Schema.Class<Model>("Model")({
  id: ModelId,
  name: Schema.NonEmptyTrimmedString,
  stocks: Schema.Array(Stock),
  flows: Schema.Array(Flow),
  variables: Schema.Array(Variable),
  timeConfig: TimeConfig,
}) {}
