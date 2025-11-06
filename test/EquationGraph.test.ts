import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import type { TestServices } from "effect/TestServices"
import { Model, Stock, Flow, Variable, TimeConfig } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Solver } from "../src/Solver.js"
import { UnitManager } from "../src/Units.js"
import { compileEquationGraph, evaluateEquationGraph } from "../src/internal/equations/GraphEngine.js"
import { makeQuantity } from "../src/internal/equations/Quantity.js"
import { ModelId, StockId, FlowId, VariableId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const population = new Stock({
  id: decodeStockId("00000000-0000-1000-8000-000000000000"),
  name: "Population",
  initialValue: 100,
  units: "people",
})

const growthRate = new Variable({
  id: decodeVariableId("00000000-0000-2000-8000-000000000000"),
  name: "GrowthRate",
  equation: "0.1",
  type: "auxiliary",
})

const netRate = new Variable({
  id: decodeVariableId("00000000-0000-2000-8000-000000000001"),
  name: "NetRate",
  equation: "[GrowthRate] - 0.02",
  type: "auxiliary",
})

const constantVar = new Variable({
  id: decodeVariableId("00000000-0000-2000-8000-000000000002"),
  name: "ConstantFactor",
  equation: "",
  type: "constant",
  value: 5,
})

const solverLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

const baseModel = new Model({
  id: decodeModelId("00000000-0000-4000-8000-000000000000"),
  name: "GraphModel",
  stocks: [population],
  flows: [],
  variables: [growthRate, netRate, constantVar],
  timeConfig: new TimeConfig({ start: 0, end: 1, step: 1 }),
})

describe("Equation graph", () => {
  it.effect("evaluates variables in dependency order", () =>
    Effect.gen(function* () {
      const compiled = yield* compileEquationGraph(baseModel.variables)
      const scope: Record<string, ReturnType<typeof makeQuantity>> = {
        Population: makeQuantity(population.initialValue),
        [population.id]: makeQuantity(population.initialValue),
        time: makeQuantity(0),
      }

      const evaluation = yield* evaluateEquationGraph(compiled, scope)

      expect(evaluation.values[growthRate.id]).toBeCloseTo(0.1)
      expect(evaluation.values[netRate.id]).toBeCloseTo(0.08)
      expect(evaluation.units[growthRate.id]).toStrictEqual({})
      expect(evaluation.values[constantVar.id]).toBeCloseTo(5)
    }),
  )

  it.effect("fails when a cycle exists", () =>
    Effect.gen(function* () {
      const varA = new Variable({
        id: decodeVariableId("10000000-0000-2000-8000-000000000000"),
        name: "A",
        equation: "[B]",
        type: "auxiliary",
      })
      const varB = new Variable({
        id: decodeVariableId("10000000-0000-2000-8000-000000000001"),
        name: "B",
        equation: "[A]",
        type: "auxiliary",
      })

      const exit = yield* compileEquationGraph([varA, varB]).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("integrates with solver evaluation", () =>
    Effect.gen(function* () {
      const flow = new Flow({
        id: decodeFlowId("20000000-0000-2000-8000-000000000000"),
        name: "Growth",
        target: population.id,
        rateEquation: "[Population] * [NetRate] / { 1 tick }",
        units: "people per tick",
      })

      const model = new Model({
        ...baseModel,
        flows: [flow],
      })

      const initialState = new SimState({
        time: 0,
        stocks: { [population.id]: population.initialValue },
        variables: {},
      })

      const solver = yield* Solver
      const next = yield* solver.step(model, initialState, 0.5)

      const nextPopulation = next.stocks[population.id] ?? 0
      const initialPopulation = initialState.stocks[population.id] ?? 0
      const netRateValue = next.variables[netRate.id] ?? 0

      expect(next.time).toBeCloseTo(0.5)
      expect(nextPopulation).toBeGreaterThan(initialPopulation)
      expect(netRateValue).toBeCloseTo(0.08)
    }).pipe(
      Effect.provide(solverLayer),
      Effect.tap(() => Effect.context<TestServices>()),
    ),
  )
})
