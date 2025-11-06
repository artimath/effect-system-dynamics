import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import type { TestServices } from "effect/TestServices"
import { Solver } from "../src/Solver.js"
import { InvalidTimeStepError } from "../src/Errors.js"
import { Model, Stock, TimeConfig, Flow, Variable } from "../src/Model.js"
import { SimState } from "../src/Simulation.js"
import { EquationEvaluator } from "../src/Equations.js"
import { UnitManager } from "../src/Units.js"
import { ModelId, StockId, FlowId, VariableId } from "../src/Types.js"
import { EquationEvaluationError } from "../src/internal/equations/errors.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

describe("Solver service interface", () => {
  const model = new Model({
    id: decodeModelId("550e8400-e29b-41d4-a716-446655440000"),
    name: "Test Model",
    stocks: [],
    flows: [],
    variables: [],
    timeConfig: new TimeConfig({ start: 0, end: 10, step: 1 }),
  })

  const initialState = new SimState({
    time: 0,
    stocks: {},
    variables: {},
  })

const TestSolverLayer = Layer.mergeAll(
  UnitManager.layer(),
  Layer.succeed(Solver, {
  name: "TestSolver",
  step: (_model: typeof model, state: SimState, dt: number) =>
      Effect.succeed(
        new SimState({
          time: state.time + dt,
          stocks: state.stocks,
          variables: state.variables,
        }),
      ),
  }),
)
const withTestSolverEnvironment = <A, E>(
  effect: Effect.Effect<A, E, Solver | UnitManager>,
): Effect.Effect<A, E, TestServices> =>
  effect.pipe(
    Effect.provide(TestSolverLayer),
    Effect.tap(() => Effect.context<TestServices>()),
  )

  it.effect("retrieves solver implementation from context", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      expect(solver.name).toBe("TestSolver")

      const result = yield* solver.step(model, initialState, 0.5)
      expect(result.time).toBeCloseTo(0.5)
      expect(result.stocks).toStrictEqual(initialState.stocks)
      expect(result.variables).toStrictEqual(initialState.variables)
    }).pipe(withTestSolverEnvironment),
  )
})

describe("Euler solver layer", () => {

const stock = new Stock({
  id: decodeStockId("550e8400-e29b-41d4-a716-446655440000"),
  name: "Population",
  initialValue: 100,
  units: "people",
})

const flow = new Flow({
  id: decodeFlowId("aa0e8400-e29b-41d4-a716-446655440000"),
  name: "Growth",
  target: stock.id,
  rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
  units: "people per tick",
})

const growthRate = new Variable({
  id: decodeVariableId("cc0e8400-e29b-41d4-a716-446655440000"),
  name: "GrowthRate",
  equation: "0.1",
  type: "auxiliary",
})

  const model = new Model({
    id: decodeModelId("660e8400-e29b-41d4-a716-446655440001"),
    name: "Population Model",
    stocks: [stock],
    flows: [flow],
    variables: [growthRate],
    timeConfig: new TimeConfig({ start: 0, end: 10, step: 0.1 }),
  })

  const baseState = new SimState({
    time: 0,
    stocks: {
      [stock.id]: stock.initialValue,
    },
    variables: {},
  })

const eulerLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

const withEulerEnvironment = <A, E>(
  effect: Effect.Effect<A, E, Solver | UnitManager | EquationEvaluator>,
): Effect.Effect<A, E, TestServices> =>
  effect.pipe(
    Effect.provide(eulerLayer),
    Effect.tap(() => Effect.context<TestServices>()),
  )

  it.effect("advances time and stock values", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const next = yield* solver.step(model, baseState, 0.5)

      expect(next.time).toBeCloseTo(0.5)
      expect(next.stocks[stock.id] ?? 0).toBeCloseTo(105)
      expect(next.variables[growthRate.id]).toBeCloseTo(0.1)
      expect(next.units.time).toStrictEqual({ tick: 1 })
      expect(next.units.stocks[stock.id]).toStrictEqual({ people: 1 })
      expect(next.units.rates[stock.id]).toStrictEqual({ people: 1, tick: -1 })
      expect(next.units.variables[growthRate.id]).toStrictEqual({})
    }).pipe(withEulerEnvironment),
  )

  it.effect("fails on non-positive dt", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const error = yield* solver
        .step(model, baseState, 0)
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(InvalidTimeStepError)
      expect((error as InvalidTimeStepError).dt).toBe(0)
    }).pipe(withEulerEnvironment),
  )

  it.effect("fails on NaN dt", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const error = yield* solver
        .step(model, baseState, Number.NaN)
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(InvalidTimeStepError)
      expect(Number.isNaN((error as InvalidTimeStepError).dt)).toBe(true)
    }).pipe(withEulerEnvironment),
  )

  it.effect("accumulates time across many steps", () =>
    Effect.gen(function* () {
      const solver = yield* Solver
      let state = baseState
      const dt = 0.1

      for (let i = 0; i < 100; i++) {
        state = yield* solver.step(model, state, dt)
      }

      expect(state.time).toBeCloseTo(10)
      const updated = state.stocks[stock.id] ?? 0
      const baseline = baseState.stocks[stock.id] ?? 0
      expect(updated).toBeGreaterThan(baseline)
      expect(state.variables[growthRate.id]).toBeCloseTo(0.1)
    }).pipe(withEulerEnvironment),
  )

  it.effect("fails when flow rate omits time dimension", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const inconsistentFlow = new Flow({
        id: decodeFlowId("dd0e8400-e29b-41d4-a716-446655440010"),
        name: "InvalidGrowth",
        target: stock.id,
        rateEquation: "[Population]",
        units: "people per tick",
      })

      const inconsistentModel = new Model({
        id: decodeModelId("990e8400-e29b-41d4-a716-446655440010"),
        name: "Invalid Model",
        stocks: [stock],
        flows: [inconsistentFlow],
        variables: [growthRate],
        timeConfig: new TimeConfig({ start: 0, end: 1, step: 0.1 }),
      })

      const result = yield* solver
        .step(inconsistentModel, baseState, 0.1)
        .pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(EquationEvaluationError)
      }
    }).pipe(withEulerEnvironment),
  )

  it.effect("fails when declared units disagree with equation", () =>
    Effect.gen(function* () {
      const solver = yield* Solver

      const mismatchedFlow = new Flow({
        id: decodeFlowId("ee0e8400-e29b-41d4-a716-446655440011"),
        name: "Mismatched",
        target: stock.id,
        rateEquation: "[Population] * [GrowthRate] / { 1 tick }",
        units: "people",
      })

      const mismatchedModel = new Model({
        id: decodeModelId("aa0e8400-e29b-41d4-a716-446655440011"),
        name: "Mismatched Model",
        stocks: [stock],
        flows: [mismatchedFlow],
        variables: [growthRate],
        timeConfig: new TimeConfig({ start: 0, end: 1, step: 0.1 }),
      })

      const result = yield* solver
        .step(mismatchedModel, baseState, 0.1)
        .pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(EquationEvaluationError)
      }
    }).pipe(Effect.provide(eulerLayer)),
  )
})
