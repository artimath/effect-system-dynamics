import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { EquationEvaluator } from "../../src/Equations.js"
import { Model, Stock, Flow, TimeConfig } from "../../src/Model.js"
import { Solver } from "../../src/Solver.js"
import { UnitManager } from "../../src/Units.js"
import { SimState, simulateEager } from "../../src/Simulation.js"
import { EquationEvaluationError } from "../../src/internal/equations/errors.js"
import { FlowId, ModelId, StockId } from "../../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)

const solverLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

describe("Units integration", () => {
  it.effect("propagates unit metadata through multi-stock transfer", () =>
    Effect.gen(function* () {
      const raw = new Stock({
        id: decodeStockId("b60e8400-e29b-41d4-a716-446655440001"),
        name: "RawMaterials",
        initialValue: 100,
        units: "kg",
      })

      const finished = new Stock({
        id: decodeStockId("c70e8400-e29b-41d4-a716-446655440002"),
        name: "FinishedGoods",
        initialValue: 0,
        units: "kg",
      })

      const processing = new Flow({
        id: decodeFlowId("d80e8400-e29b-41d4-a716-446655440003"),
        name: "Processing",
        source: raw.id,
        target: finished.id,
        rateEquation: "[RawMaterials] / { 5 tick }",
        units: "kg per tick",
      })

      const demand = new Flow({
        id: decodeFlowId("e90e8400-e29b-41d4-a716-446655440004"),
        name: "Demand",
        source: finished.id,
        rateEquation: "[FinishedGoods] / { 10 tick }",
        units: "kg per tick",
      })

      const model = new Model({
        id: decodeModelId("f10e8400-e29b-41d4-a716-446655440005"),
        name: "ManufacturingPipeline",
        stocks: [raw, finished],
        flows: [processing, demand],
        variables: [],
        timeConfig: new TimeConfig({ start: 0, end: 20, step: 1 }),
      })

      const states = yield* simulateEager(model)

      expect(states.at(-1)?.time).toBeCloseTo(20)
      expect(states[0]?.units.time).toStrictEqual({ tick: 1 })
      expect(states[0]?.units.stocks[raw.id]).toStrictEqual({ kg: 1 })
      expect(states[0]?.units.rates[raw.id]).toStrictEqual({ kg: 1, tick: -1 })
      expect(states[0]?.units.stocks[finished.id]).toStrictEqual({ kg: 1 })
      expect(states[0]?.units.rates[finished.id]).toStrictEqual({ kg: 1, tick: -1 })

      const finishedLevels = states.map((state) => state.stocks[finished.id])
      expect(finishedLevels.at(-1)).toBeGreaterThan(finishedLevels[0]!)
    }).pipe(Effect.provide(solverLayer)),
  )

  it.effect("rejects flows that bridge incompatible stock units", () =>
    Effect.gen(function* () {
      const raw = new Stock({
        id: decodeStockId("010e8400-e29b-41d4-a716-446655440006"),
        name: "Ore",
        initialValue: 100,
        units: "kg",
      })

      const water = new Stock({
        id: decodeStockId("020e8400-e29b-41d4-a716-446655440007"),
        name: "CoolingWater",
        initialValue: 50,
        units: "liters",
      })

      const incompatibleFlow = new Flow({
        id: decodeFlowId("030e8400-e29b-41d4-a716-446655440008"),
        name: "Contaminate",
        source: raw.id,
        target: water.id,
        rateEquation: "[Ore] / { 5 tick }",
        units: "kg per tick",
      })

      const model = new Model({
        id: decodeModelId("040e8400-e29b-41d4-a716-446655440009"),
        name: "BadTransfer",
        stocks: [raw, water],
        flows: [incompatibleFlow],
        variables: [],
        timeConfig: new TimeConfig({ start: 0, end: 1, step: 1 }),
      })

      const solver = yield* Solver

      const initialState = new SimState({
        time: 0,
        stocks: {
          [raw.id]: raw.initialValue,
          [water.id]: water.initialValue,
        },
        variables: {},
      })

      const result = yield* solver.step(model, initialState, 1).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(EquationEvaluationError)
      }
    }).pipe(Effect.provide(solverLayer)),
  )
})
