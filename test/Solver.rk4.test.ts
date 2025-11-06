import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { performance } from "node:perf_hooks"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Model, Stock, Flow, TimeConfig, Variable } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { ModelId, StockId, FlowId, VariableId } from "../src/Types.js"
import { InvalidTimeStepError } from "../src/Errors.js"
import { UnitManager } from "../src/Units.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const rk4Layer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.RK4)

describe("RK4 solver", () => {
  const population = new Stock({
    id: decodeStockId("770e8400-e29b-41d4-a716-446655440002"),
    name: "Population",
    initialValue: 1,
    units: "people",
  })

  const timeFactor = new Variable({
    id: decodeVariableId("780e8400-e29b-41d4-a716-446655440002"),
    name: "TimeFactor",
    equation: "time / { 1 tick }",
    type: "auxiliary",
  })

  const growthRate = new Variable({
    id: decodeVariableId("790e8400-e29b-41d4-a716-446655440002"),
    name: "GrowthRate",
    equation: "[TimeFactor]",
    type: "auxiliary",
  })

  const growth = new Flow({
    id: decodeFlowId("bb0e8400-e29b-41d4-a716-446655440002"),
    name: "Growth",
    target: population.id,
    rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
    units: "people per tick",
  })

  const baseModel = new Model({
    id: decodeModelId("880e8400-e29b-41d4-a716-446655440003"),
    name: "Time Driven Growth",
    stocks: [population],
    flows: [growth],
    variables: [timeFactor, growthRate],
    timeConfig: new TimeConfig({ start: 0, end: 1, step: 0.1 }),
  })

  const initialState = new SimState({
    time: 0,
    stocks: { [population.id]: population.initialValue },
    variables: {},
  })

  it.effect("matches analytic solution for dy/dt = t * y", () =>
    Effect.gen(function* () {
      const solver = yield* Solver
      let state = initialState
      const steps = Math.round((baseModel.timeConfig.end - baseModel.timeConfig.start) / baseModel.timeConfig.step)

      for (let index = 0; index < steps; index += 1) {
        state = yield* solver.step(baseModel, state, baseModel.timeConfig.step)
      }

      const expected = Math.exp(0.5) * population.initialValue

      expect(state.time).toBeCloseTo(1, 10)
      expect(state.stocks[population.id]).toBeCloseTo(expected, 4)
      expect(state.variables[timeFactor.id]).toBeCloseTo(state.time, 6)
      expect(state.units.stocks[population.id]).toStrictEqual({ people: 1 })
      expect(state.units.rates[population.id]).toStrictEqual({ people: 1, tick: -1 })
    }).pipe(Effect.provide(rk4Layer)),
  )

  it.effect("rejects invalid timesteps", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const zeroError = yield* solver
        .step(baseModel, initialState, 0)
        .pipe(Effect.flip)

      expect(zeroError).toBeInstanceOf(InvalidTimeStepError)

      const nanError = yield* solver
        .step(baseModel, initialState, Number.NaN)
        .pipe(Effect.flip)

      expect(nanError).toBeInstanceOf(InvalidTimeStepError)
    }).pipe(Effect.provide(rk4Layer)),
  )

  it.effect("fails when flow omits required time units", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const brokenFlow = new Flow({
        id: decodeFlowId("cc0e8400-e29b-41d4-a716-446655440010"),
        name: "Bad",
        target: population.id,
        rateEquation: "[Population]",
        units: "people per tick",
      })

      const badModel = new Model({
        id: decodeModelId("990e8400-e29b-41d4-a716-446655440010"),
        name: "Invalid Units",
        stocks: [population],
        flows: [brokenFlow],
        variables: [],
        timeConfig: new TimeConfig({ start: 0, end: 1, step: 0.1 }),
      })

      const exit = yield* solver.step(badModel, initialState, 0.1).pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(rk4Layer)),
  )

  it.effect("executes 1000 steps within performance envelope", () =>
    Effect.gen(function* () {
      const solver = yield* Solver
      const perfModel = new Model({
        id: decodeModelId("aa0e8400-e29b-41d4-a716-446655440099"),
        name: "Performance Model",
        stocks: [population],
        flows: [growth],
        variables: [timeFactor, growthRate],
        timeConfig: new TimeConfig({ start: 0, end: 10, step: 0.01 }),
      })

      let state = initialState
      const dt = perfModel.timeConfig.step
      const iterations = Math.round((perfModel.timeConfig.end - perfModel.timeConfig.start) / dt)

      const start = performance.now()
      for (let index = 0; index < iterations; index += 1) {
        state = yield* solver.step(perfModel, state, dt)
      }
      const elapsed = performance.now() - start

      expect(state.time).toBeCloseTo(10, 6)
      expect(elapsed).toBeLessThan(3000)
    }).pipe(Effect.provide(rk4Layer)),
  )
})
