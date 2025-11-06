import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { UnitDefinition, UnitManager } from "../src/Units.js"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Model, Stock, Flow, TimeConfig } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { EquationEvaluationError } from "../src/internal/equations/errors.js"
import { ModelId, StockId, FlowId } from "../src/Types.js"
import { Schema } from "effect"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)

describe("UnitManager", () => {
  it.effect("provides default unit lookups", () =>
    Effect.gen(function* () {
      const manager = yield* UnitManager
      const people = yield* manager.find("people")
      expect(people.dimension).toStrictEqual({ population: 1 })
    }).pipe(Effect.provide(UnitManager.layer())),
  )

  it.effect("registers custom units and performs conversions", () =>
    Effect.gen(function* () {
      const manager = yield* UnitManager
      yield* manager.register([
        new UnitDefinition({ symbol: "gallon", dimension: { volume: 1 }, factor: 3.78541 }),
      ])

      const liters = yield* manager.convertValue(10, "gallon", "liters")
      expect(liters).toBeCloseTo(37.8541)
    }).pipe(Effect.provide(UnitManager.layer())),
  )

  it.effect("causes solver to fail when units are unregistered", () => {
    const layer = Layer.mergeAll(UnitManager.layer([]), EquationEvaluator.layer, Solver.Euler)

    return Effect.gen(function* () {
      const stock = new Stock({
        id: decodeStockId("cc0e8400-e29b-41d4-a716-446655449999"),
        name: "Inventory",
        initialValue: 100,
        units: "widgets",
      })

      const flow = new Flow({
        id: decodeFlowId("dd0e8400-e29b-41d4-a716-446655449999"),
        name: "Outflow",
        source: stock.id,
        rateEquation: "{ 5 widgets } / { 1 tick }",
        units: "widgets per tick",
      })

      const model = new Model({
        id: decodeModelId("ee0e8400-e29b-41d4-a716-446655449999"),
        name: "MissingUnits",
        stocks: [stock],
        flows: [flow],
        variables: [],
        timeConfig: new TimeConfig({ start: 0, end: 1, step: 1 }),
      })

      const solver = yield* Solver
      const state = new SimState({ time: 0, stocks: { [stock.id]: stock.initialValue }, variables: {} })

      const error = yield* solver.step(model, state, 1).pipe(Effect.flip)
      expect(error).toBeInstanceOf(EquationEvaluationError)
      if (error instanceof EquationEvaluationError) {
        expect(error.problem.toLowerCase()).toContain("unit \"tick\" is not registered")
      }
    }).pipe(Effect.provide(layer))
  })
})
