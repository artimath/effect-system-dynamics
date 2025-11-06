import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import type { TestServices } from "effect/TestServices"
import { Solver, type AdaptiveSolverOptions } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Model, Stock, Flow, TimeConfig, Variable } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { ModelId, StockId, FlowId, VariableId } from "../src/Types.js"
import { ConvergenceError } from "../src/Errors.js"
import { UnitManager } from "../src/Units.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const makePopulationModel = (
  rateExpression: string,
  timeConfig: TimeConfig,
  initialValue = 1,
) => {
  const population = new Stock({
    id: decodeStockId("880e8400-e29b-41d4-a716-446655441111"),
    name: "Population",
    initialValue,
    units: "people",
  })

  const rateVariable = new Variable({
    id: decodeVariableId("770e8400-e29b-41d4-a716-446655441111"),
    name: "GrowthRate",
    equation: rateExpression,
    type: "auxiliary",
  })

  const growth = new Flow({
    id: decodeFlowId("990e8400-e29b-41d4-a716-446655441111"),
    name: "Growth",
    target: population.id,
    rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
    units: "people per tick",
  })

  return new Model({
    id: decodeModelId("550e8400-e29b-41d4-a716-446655441111"),
    name: "Population Growth",
    stocks: [population],
    flows: [growth],
    variables: [rateVariable],
    timeConfig,
  })
}

const makeInitialState = (model: Model) =>
  new SimState({
    time: model.timeConfig.start,
    stocks: Object.fromEntries(model.stocks.map((stock) => [stock.id, stock.initialValue] as const)),
    variables: {},
  })

describe("Adaptive solver", () => {
  const baseLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Adaptive())

  const withAdaptiveEnvironment = <A, E>(
    effect: Effect.Effect<A, E, Solver | UnitManager | EquationEvaluator>,
  ): Effect.Effect<A, E, TestServices> =>
    effect.pipe(
      Effect.provide(baseLayer),
      Effect.tap(() => Effect.context<TestServices>()),
    )

  const provideWithLayer = <A, E>(
    layer: Layer.Layer<any, any, any>,
    effect: Effect.Effect<A, E, Solver | UnitManager | EquationEvaluator>,
  ): Effect.Effect<A, E, TestServices> =>
    effect.pipe(
      Effect.provide(layer),
      Effect.tap(() => Effect.context<TestServices>()),
    )

  it.effect("matches analytic exponential within tolerance", () =>
    Effect.gen(function* () {
      const model = makePopulationModel("1", new TimeConfig({ start: 0, end: 1, step: 1 }))
      const solver = yield* Solver
      let state = makeInitialState(model)

      // integrate across the unit interval in two macro steps
      for (let index = 0; index < 2; index += 1) {
        state = yield* solver.step(model, state, 0.5)
      }

      const expected = Math.exp(1)
      expect(state.time).toBeCloseTo(1, 6)
      const stockId = model.stocks[0]?.id
      expect(stockId ? state.stocks[stockId] ?? 0 : 0).toBeCloseTo(expected, 3)
    }).pipe(withAdaptiveEnvironment),
  )

  it.effect("fails fast when step cannot shrink to satisfy tolerance", () => {
    const tightOptions: AdaptiveSolverOptions = {
      initialStep: 0.5,
      minStep: 0.5,
      maxStep: 0.5,
      absoluteTolerance: 1e-12,
      relativeTolerance: 1e-12,
      maxAttemptsPerStep: 2,
    }

    const layer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Adaptive(tightOptions))

    return provideWithLayer(
      layer,
      Effect.gen(function* () {
        const stiffModel = makePopulationModel("25", new TimeConfig({ start: 0, end: 0.5, step: 0.5 }))

        const solver = yield* Solver

        const error = yield* solver
          .step(stiffModel, makeInitialState(stiffModel), 0.5)
          .pipe(Effect.flip)

        expect(error).toBeInstanceOf(ConvergenceError)
      }),
    )
  })

  it.effect("respects model end time when requested dt overshoots", () =>
    Effect.gen(function* () {
      const shortModel = makePopulationModel("0.5", new TimeConfig({ start: 0, end: 0.6, step: 1 }))
      const solver = yield* Solver

      const startingState = makeInitialState(shortModel)
      const state = yield* solver.step(shortModel, startingState, 1)

      expect(state.time).toBeCloseTo(0.6, 6)
      const stockId = shortModel.stocks[0]?.id
      const finalValue = stockId ? state.stocks[stockId] ?? 0 : 0
      const initialValue = stockId ? startingState.stocks[stockId] ?? 0 : 0
      expect(finalValue).toBeGreaterThan(initialValue)
    }).pipe(withAdaptiveEnvironment),
  )
})
