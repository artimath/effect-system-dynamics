import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import {
  ScenarioDefinition,
  ScenarioService,
  SensitivityService,
  OptimizerService,
  ScenarioComparison,
  Objective,
  Constraint,
  ScenarioServicesLayer,
} from "../src/Scenarios.js"
import { Model, Stock, Flow, Variable, TimeConfig } from "../src/Model.js"
import { ScenarioId, ModelId, StockId, FlowId, VariableId } from "../src/Types.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Solver } from "../src/Solver.js"
import { UnitManager } from "../src/Units.js"

const decodeScenarioId = Schema.decodeSync(ScenarioId)
const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const makeBaseModel = () => {
  const population = new Stock({
    id: decodeStockId("550e8400-e29b-41d4-a716-446655440000"),
    name: "Population",
    initialValue: 100,
    units: "people",
  })

  const growth = new Variable({
    id: decodeVariableId("660e8400-e29b-41d4-a716-446655440000"),
    name: "GrowthRate",
    equation: "0.1",
    type: "constant",
    value: 0.1,
  })

  const flow = new Flow({
    id: decodeFlowId("770e8400-e29b-41d4-a716-446655440000"),
    name: "Growth",
    target: population.id,
    rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
    units: "people per tick",
  })

  return new Model({
    id: decodeModelId("880e8400-e29b-41d4-a716-446655440000"),
    name: "Population Growth",
    stocks: [population],
    flows: [flow],
    variables: [growth],
    timeConfig: new TimeConfig({ start: 0, end: 10, step: 1 }),
  })
}

const scenarioEnvironmentLayer = Layer.mergeAll(
  ScenarioServicesLayer,
  UnitManager.layer(),
  Solver.Euler,
  EquationEvaluator.layer,
)

describe("Scenarios", () => {
  it.effect("branches models with overrides", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const scenario = new ScenarioDefinition({
        id: decodeScenarioId("990e8400-e29b-41d4-a716-446655440000"),
        name: "High Start",
        baseModelId: model.id,
        overrides: { Population: 200 },
      })

      const service = yield* ScenarioService
      const branched = yield* service.branch(model, scenario)

      expect(branched.model.stocks[0]?.initialValue).toBe(200)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )

  it.effect("compares baseline against scenarios", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const scenario = new ScenarioDefinition({
        id: decodeScenarioId("aa0e8400-e29b-41d4-a716-446655440000"),
        name: "Boost",
        baseModelId: model.id,
        overrides: { GrowthRate: 0.15 },
      })

      const service = yield* ScenarioService
      const comparison = yield* service.compare(model, [scenario], {
        collectStates: true,
        parallelism: 2,
      })

      expect(comparison).toBeInstanceOf(ScenarioComparison)
      expect(comparison.scenarios).toHaveLength(1)
      const summary = comparison.scenarios[0]
      expect(summary).toBeDefined()
      expect(summary?.deltaVariables?.GrowthRate ?? 0).toBeCloseTo(0.05)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )

  it.effect("performs sensitivity analysis", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const sensitivity = yield* SensitivityService

      const results = yield* sensitivity.analyze(
        model,
        "Population",
        ["Population", "GrowthRate"],
        10,
      )

      expect(results).toHaveLength(2)
      const growthRateResult = results.find((result) => result.parameter === "GrowthRate")
      expect(growthRateResult?.impact ?? 0).toBeGreaterThan(0)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )

  it.effect("optimizes parameters via grid search", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const optimizer = yield* OptimizerService

      const objective = new Objective({
        target: "Population",
        direction: "maximize",
        atTime: 10,
      })

      const constraints = [
        new Constraint({
          parameter: "GrowthRate",
          min: 0.05,
          max: 0.15,
        }),
      ]

      const result = yield* optimizer.optimize(model, objective, constraints, {
        stepsPerParameter: 3,
      })

      expect(result.bestParameters.GrowthRate).toBeCloseTo(0.15)
      expect(result.value).toBeGreaterThan(0)
      expect(result.strategy).toBe("grid")
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )
})
