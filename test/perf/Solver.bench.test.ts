import { bench, describe } from "vitest"
import { Effect, Layer, Schema } from "effect"
import { performance } from "node:perf_hooks"
import { Solver } from "../../src/Solver.js"
import { EquationEvaluator } from "../../src/Equations.js"
import { UnitManager } from "../../src/Units.js"
import { Model, Stock, Flow, Variable, TimeConfig } from "../../src/Model.js"
import { SimState } from "../../src/Simulation.js"
import { ModelId, StockId, FlowId, VariableId } from "../../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const rk4Layer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.RK4)

const population = new Stock({
  id: decodeStockId("aa0e8400-e29b-41d4-a716-446655440200"),
  name: "Population",
  initialValue: 1,
  units: "people",
})

const timeFactor = new Variable({
  id: decodeVariableId("aa1e8400-e29b-41d4-a716-446655440200"),
  name: "TimeFactor",
  equation: "time / { 1 tick }",
  type: "auxiliary",
})

const growthRate = new Variable({
  id: decodeVariableId("aa2e8400-e29b-41d4-a716-446655440200"),
  name: "GrowthRate",
  equation: "[TimeFactor]",
  type: "auxiliary",
})

const growthFlow = new Flow({
  id: decodeFlowId("aa3e8400-e29b-41d4-a716-446655440200"),
  name: "Growth",
  target: population.id,
  rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
  units: "people per tick",
})

const perfModel = new Model({
  id: decodeModelId("aa4e8400-e29b-41d4-a716-446655440200"),
  name: "Performance Model",
  stocks: [population],
  flows: [growthFlow],
  variables: [timeFactor, growthRate],
  timeConfig: new TimeConfig({ start: 0, end: 10, step: 0.01 }),
})

const initialState = new SimState({
  time: 0,
  stocks: { [population.id]: population.initialValue },
  variables: {},
})

if (process.env.VITEST_MODE === "bench") {
  describe("solver benchmarks", () => {
    bench("rk4 1000 steps", async () => {
      const program = Effect.gen(function* () {
        const solver = yield* Solver
        const iterations = Math.round(
          (perfModel.timeConfig.end - perfModel.timeConfig.start) / perfModel.timeConfig.step,
        )
        let state = initialState
        const start = performance.now()
        for (let index = 0; index < iterations; index += 1) {
          state = yield* solver.step(perfModel, state, perfModel.timeConfig.step)
        }
        const elapsed = performance.now() - start
        if (elapsed > 1200) {
          throw new Error(`RK4 baseline regression: ${elapsed.toFixed(2)}ms (> 1200ms) for 1000 steps`)
        }
      })

      await Effect.runPromise(program.pipe(Effect.provide(rk4Layer)))
    })
  })
} else {
  describe.skip("solver benchmarks", () => {
    // Benchmarks execute only when VITEST_MODE=bench
  })
}
