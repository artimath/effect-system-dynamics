import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { Model, Stock, TimeConfig, Variable } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { UnitManager } from "../src/Units.js"
import { ModelId, StockId, VariableId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeVariableId = Schema.decodeSync(VariableId)

const solverLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

const timeConfig = new TimeConfig({ start: 0, end: 1, step: 0.1 })

const stock = new Stock({
  id: decodeStockId("3a0e8400-e29b-41d4-a716-446655440210"),
  name: "Sink",
  initialValue: 0,
})

const input = new Variable({
  id: decodeVariableId("3b0e8400-e29b-41d4-a716-446655440210"),
  name: "Input",
  equation: "TIME",
  type: "auxiliary",
})

const lagged = new Variable({
  id: decodeVariableId("3c0e8400-e29b-41d4-a716-446655440210"),
  name: "LaggedInput",
  equation: "DELAY1([Input], 1 { tick }, 0 { tick })",
  type: "auxiliary",
})

const smoothZeroTau = new Variable({
  id: decodeVariableId("3d0e8400-e29b-41d4-a716-446655440211"),
  name: "SmoothZeroTau",
  equation: "SMOOTH3([Input], 0 { tick })",
  type: "auxiliary",
})

const model = new Model({
  id: decodeModelId("3d0e8400-e29b-41d4-a716-446655440210"),
  name: "Delay Harness",
  stocks: [stock],
  flows: [],
  variables: [input, lagged, smoothZeroTau],
  timeConfig,
})

const initialState = new SimState({
  time: timeConfig.start,
  stocks: { [stock.id]: stock.initialValue },
  variables: {},
})

const computeExpectedLagged = (steps: number, dt: number, tau: number) => {
  const values: Array<number> = []
  const alpha = dt / tau
  let current = 0
  for (let index = 0; index < steps; index += 1) {
    const time = index * dt
    current = current + alpha * (time - current)
    values.push(current)
  }
  return values
}

describe("Delay primitives", () => {
  it.effect("persists DELAY1 state across Euler steps and resets on restart", () =>
    Effect.gen(function* () {
      const solver = yield* Solver
      const dt = model.timeConfig.step
      const steps = 6
      const expected = computeExpectedLagged(steps, dt, 1)

      let state = initialState
      const observed: Array<number> = []
      for (let index = 0; index < steps; index += 1) {
        state = yield* solver.step(model, state, dt)
        observed.push(state.variables[lagged.id] ?? Number.NaN)
        const smoothValue = state.variables[smoothZeroTau.id] ?? Number.NaN
        expect(smoothValue).toBeCloseTo(state.time - dt, 6)
      }

      expect(observed.length).toBe(steps)
      for (let index = 0; index < steps; index += 1) {
        expect(observed[index]).toBeCloseTo(expected[index]!, 6)
      }
      expect(state.units.variables[lagged.id]).toStrictEqual({ tick: 1 })
      expect(state.units.variables[smoothZeroTau.id]).toStrictEqual({ tick: 1 })

      // Restarting from the initial state should rebuild the delay store.
      let restart = initialState
      restart = yield* solver.step(model, restart, dt)
      restart = yield* solver.step(model, restart, dt)
      expect(restart.variables[lagged.id]).toBeCloseTo(expected[1]!, 6)
    }).pipe(Effect.provide(solverLayer)),
  )
})
