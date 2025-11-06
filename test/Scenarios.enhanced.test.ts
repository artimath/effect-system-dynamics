import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import {
  OptimizerService,
  Objective,
  Constraint,
  OptimizationStrategy,
  ScenarioDefinition,
  ScenarioServicesLayer,
  ScenarioService,
} from "../src/Scenarios.js"
import { Model, Stock, Flow, Variable, TimeConfig } from "../src/Model.js"
import { ModelId, StockId, FlowId, VariableId, ScenarioId } from "../src/Types.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Solver } from "../src/Solver.js"
import { UnitManager } from "../src/Units.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)
const decodeScenarioId = Schema.decodeSync(ScenarioId)

const makeBaseModel = () => {
  const population = new Stock({
    id: decodeStockId("550e8400-e29b-41d4-a716-446655440111"),
    name: "Population",
    initialValue: 100,
    units: "people",
  })

  const growth = new Variable({
    id: decodeVariableId("660e8400-e29b-41d4-a716-446655440111"),
    name: "GrowthRate",
    equation: "0.1",
    type: "constant",
    value: 0.1,
  })

  const flow = new Flow({
    id: decodeFlowId("770e8400-e29b-41d4-a716-446655440111"),
    name: "Growth",
    target: population.id,
    rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
    units: "people per tick",
  })

  return new Model({
    id: decodeModelId("880e8400-e29b-41d4-a716-446655440111"),
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

describe("Scenario optimization strategies", () => {
  it.effect("supports random search", () =>
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
          min: 0.12,
          max: 0.12,
        }),
      ]

      const result = yield* optimizer.optimize(model, objective, constraints, {
        strategy: "random",
        iterations: 5,
      })

      expect(result.strategy).toBe("random")
      expect(result.bestParameters.GrowthRate).toBeCloseTo(0.12)
      expect(result.iterations).toBeGreaterThan(0)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )

  it.effect("accepts custom optimization strategies", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const optimizer = yield* OptimizerService

      const objective = new Objective({
        target: "Population",
        direction: "maximize",
        atTime: 5,
      })

      const constraints: ReadonlyArray<Constraint> = []

      const customStrategy: OptimizationStrategy = {
        name: "custom",
        optimize: () =>
          Effect.succeed({
            bestParameters: { GrowthRate: 0.11 },
            bestValue: 42,
            iterations: 0,
          }),
      }

      const result = yield* optimizer.optimize(model, objective, constraints, {
        strategy: customStrategy,
      })

      expect(result.strategy).toBe("custom")
      expect(result.bestParameters.GrowthRate).toBeCloseTo(0.11)
      expect(result.value).toBe(42)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )

  it.effect("executes Monte Carlo runs with deterministic seed", () =>
    Effect.gen(function* () {
      const model = makeBaseModel()
      const scenarioService = yield* ScenarioService

      const baseScenario = new ScenarioDefinition({
        id: decodeScenarioId("aa1e8400-e29b-41d4-a716-446655440111"),
        name: "Baseline",
        baseModelId: model.id,
        overrides: {},
      })

      const options = {
        iterations: 5,
        metrics: ["Population"],
        parameters: [
          {
            name: "GrowthRate",
            sampler: ({ baseline, random }: { baseline: number; random: () => number }) =>
              baseline * (0.9 + random() * 0.2),
          },
        ],
        seed: 12345,
      } as const

      const first = yield* scenarioService.monteCarlo(model, baseScenario, options)
      const second = yield* scenarioService.monteCarlo(model, baseScenario, options)

      expect(first.iterations).toBe(5)
      expect(first.metrics).toHaveLength(1)
      const metric = first.metrics[0]
      expect(metric?.name).toBe("Population")
      expect(metric?.percentiles.map((entry) => entry.percentile)).toStrictEqual([0.5, 0.9, 0.95])
      expect(second.metrics[0]?.mean ?? 0).toBeCloseTo(metric?.mean ?? 0)
      expect(second.metrics[0]?.variance ?? 0).toBeCloseTo(metric?.variance ?? 0)
    }).pipe(Effect.provide(scenarioEnvironmentLayer)),
  )
})
