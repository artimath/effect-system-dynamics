import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { Model, Stock, Flow, Variable, TimeConfig } from "../src/Model.js"
import {
  ParallelSimulationResult,
  simulateParallel,
} from "../src/Simulation.js"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { UnitManager } from "../src/Units.js"
import { ModelId, StockId, FlowId, VariableId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const environment = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

const makePopulationModel = (initialPopulation: number, growth: number, identifier: "A" | "B") => {
  const suffix = identifier === "A" ? "0000" : "1111"

  const population = new Stock({
    id: decodeStockId(`550e8400-e29b-41d4-a716-44665544${suffix}`),
    name: `Population-${identifier}`,
    initialValue: initialPopulation,
    units: "people",
  })

  const growthRate = new Variable({
    id: decodeVariableId(`660e8400-e29b-41d4-a716-44665544${suffix}`),
    name: `GrowthRate-${identifier}`,
    equation: String(growth),
    type: "constant",
    value: growth,
  })

  const flow = new Flow({
    id: decodeFlowId(`770e8400-e29b-41d4-a716-44665544${suffix}`),
    name: `Growth-${identifier}`,
    target: population.id,
    rateEquation: `[${population.name}] * [${growthRate.name}] / { 1 tick }`,
    units: "people per tick",
  })

  return new Model({
    id: decodeModelId(`880e8400-e29b-41d4-a716-44665544${suffix}`),
    name: `Population Model ${identifier}`,
    stocks: [population],
    flows: [flow],
    variables: [growthRate],
    timeConfig: new TimeConfig({ start: 0, end: 5, step: 1 }),
  })
}

describe("simulateParallel", () => {
  it.effect("runs multiple simulations with optional state collection", () =>
    Effect.gen(function* () {
      const modelA = makePopulationModel(100, 0.2, "A")
      const modelB = makePopulationModel(200, 0.05, "B")

      const results = yield* simulateParallel(
        [
          { id: "A", model: modelA, collectStates: true },
          { id: "B", model: modelB },
        ],
        { parallelism: 1 },
      )

      expect(results).toHaveLength(2)

      const first = results[0] as ParallelSimulationResult
      expect(first.id).toBe("A")
      expect(first.states?.length ?? 0).toBeGreaterThan(0)
      expect(first.final.time).toBe(modelA.timeConfig.end)

      const second = results[1] as ParallelSimulationResult
      expect(second.id).toBe("B")
      expect(second.states).toBeUndefined()
      expect(second.final.time).toBe(modelB.timeConfig.end)
    }).pipe(Effect.provide(environment)),
  )

  it.effect("returns empty results when no targets provided", () =>
    Effect.gen(function* () {
      const results = yield* simulateParallel([], { parallelism: 4 })
      expect(results).toHaveLength(0)
    }).pipe(Effect.provide(environment)),
  )
})
