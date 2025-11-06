import { describe, it, expect } from "@effect/vitest"
import { Cause, Chunk, Effect, Layer, Schema, Stream } from "effect"
import { ConvergenceError } from "../src/Errors.js"
import { Model, Stock, TimeConfig, Flow } from "../src/Model.js"
import { SimState, simulate, simulateEager, simulateFinal } from "../src/Simulation.js"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { UnitManager } from "../src/Units.js"
import { ModelId, StockId, FlowId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const solverLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

describe("SimState schema", () => {
  const decode = Schema.decodeUnknownSync(SimState)

  it("decodes a valid simulation state", () => {
    const state = decode({
      time: 1.5,
      stocks: {
        population: 1000,
        inventory: 250.5,
      },
      variables: {
        growthRate: 0.02,
      },
      units: {
        stocks: {
          population: { people: 1 },
          inventory: { widgets: 1 },
        },
        variables: {
          growthRate: { tick: -1 },
        },
        rates: {
          population: { people: 1, tick: -1 },
          inventory: { widgets: 1, tick: -1 },
        },
        time: { tick: 1 },
      },
    })

    expect(state.time).toBe(1.5)
    expect(state.stocks.population).toBe(1000)
    expect(state.variables.growthRate).toBe(0.02)
  })

  it("allows units to be omitted", () => {
    const state = decode({
      time: 0,
      stocks: {},
      variables: {},
    })

    const defaultUnits = state.units
    expect(defaultUnits).toBeDefined()
    expect(defaultUnits?.stocks).toEqual({})
    expect(defaultUnits?.variables).toEqual({})
    expect(defaultUnits?.rates).toEqual({})
    expect(defaultUnits?.time).toEqual({})
  })

  it("accepts empty stock and variable records", () => {
    const state = decode({
      time: 0,
      stocks: {},
      variables: {},
    })

    expect(state.time).toBe(0)
    expect(Object.keys(state.stocks)).toHaveLength(0)
    expect(Object.keys(state.variables)).toHaveLength(0)
  })

  it("rejects non-finite stock values", () => {
    expect(() =>
      decode({
        time: 0,
        stocks: {
          population: Number.NaN,
        },
        variables: {},
      }),
    ).toThrow()
  })

  it("rejects non-finite variable values", () => {
    expect(() =>
      decode({
        time: 0,
        stocks: {},
        variables: {
          growthRate: Number.POSITIVE_INFINITY,
        },
      }),
    ).toThrow()
  })
})

describe("simulate", () => {
  const stock = new Stock({
    id: decodeStockId("550e8400-e29b-41d4-a716-446655440000"),
    name: "Population",
    initialValue: 10,
    units: "widgets",
  })

  const model = new Model({
    id: decodeModelId("660e8400-e29b-41d4-a716-446655440001"),
    name: "Population Growth",
    stocks: [stock],
    flows: [
      new Flow({
        id: decodeFlowId("aa0e8400-e29b-41d4-a716-446655440001"),
        name: "Growth",
        target: stock.id,
        rateEquation: "{ 1 widgets } / { 1 tick }",
        units: "widgets per tick",
      }),
    ],
    variables: [],
    timeConfig: new TimeConfig({ start: 0, end: 2, step: 0.5 }),
  })

  it.effect("streams states until the configured end time", () =>
    Effect.gen(function* () {
      const stream = yield* simulate(model).pipe(Effect.provide(solverLayer))
      const chunk = yield* Stream.runCollect(stream)
      const states = Chunk.toReadonlyArray(chunk)

      expect(states.length).toBe(5)
      expect(states.map((state) => state.time)).toStrictEqual([0, 0.5, 1, 1.5, 2])

      const first = states[0]!
      const second = states[1]!
      const last = states.at(-1)!

      expect(first.stocks[stock.id] ?? 0).toBeCloseTo(10)
      expect(second.stocks[stock.id] ?? 0).toBeCloseTo(10.5)
      expect(last.time).toBe(model.timeConfig.end)
      expect(first.units.time).toStrictEqual({ tick: 1 })
      expect(first.units.stocks[stock.id]).toStrictEqual({ widgets: 1 })
      expect(second.units.rates[stock.id]).toStrictEqual({ widgets: 1, tick: -1 })
    }),
  )

  it.effect("propagates solver failures", () =>
    Effect.gen(function* () {
      const failingLayer = Layer.succeed(Solver, {
        name: "FailingSolver",
        step: () =>
          Effect.fail(
            new ConvergenceError({
              model: model.id,
              timeStep: 0,
              error: 42,
            }),
          ),
      })

      const environment = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, failingLayer)

      const program = Effect.gen(function* () {
        const stream = yield* simulate(model)
        yield* Stream.runCollect(stream)
      })

      const error = yield* program
        .pipe(Effect.provide(environment))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(ConvergenceError)
      if (error instanceof ConvergenceError) {
        expect(error.model).toBe(model.id)
      }
    }),
  )
})

describe("simulation wrappers", () => {
  const stock = new Stock({
    id: decodeStockId("770e8400-e29b-41d4-a716-446655440002"),
    name: "Inventory",
    initialValue: 5,
    units: "inventory",
  })

  const model = new Model({
    id: decodeModelId("880e8400-e29b-41d4-a716-446655440003"),
    name: "Inventory Tracker",
    stocks: [stock],
    flows: [
      new Flow({
        id: decodeFlowId("bb0e8400-e29b-41d4-a716-446655440003"),
        name: "Restock",
        target: stock.id,
        rateEquation: "{ 0.5 inventory } / { 1 tick }",
        units: "inventory per tick",
      }),
    ],
    variables: [],
    timeConfig: new TimeConfig({ start: 0, end: 1, step: 0.25 }),
  })

  it.effect("collects all states eagerly", () =>
    Effect.gen(function* () {
      const states = yield* simulateEager(model).pipe(Effect.provide(solverLayer))

      expect(states.length).toBe(5)
      const first = states[0]!
      const last = states.at(-1)!
      expect(first.time).toBe(0)
      expect(last.time).toBeCloseTo(1)
      expect((last.stocks[stock.id] ?? 0)).toBeGreaterThan(first.stocks[stock.id] ?? 0)
      expect(first.units.stocks[stock.id]).toStrictEqual({ inventory: 1 })
      expect(first.units.rates[stock.id]).toStrictEqual({ inventory: 1, tick: -1 })
    }),
  )

  it.effect("returns only the final state", () =>
    Effect.gen(function* () {
      const finalState = yield* simulateFinal(model).pipe(Effect.provide(solverLayer))

      expect(finalState.time).toBeCloseTo(1)
      expect(finalState.units.time).toStrictEqual({ tick: 1 })
    }),
  )

  it.effect("fails when no timesteps exist", () =>
    Effect.gen(function* () {
      const degenerateModel = new Model({
        id: decodeModelId("990e8400-e29b-41d4-a716-446655440004"),
        name: "Empty",
        stocks: [stock],
        flows: [],
        variables: [],
        timeConfig: new TimeConfig({ start: 5, end: 5, step: 0.25 }),
      })

      const error = yield* simulateFinal(degenerateModel)
        .pipe(Effect.provide(solverLayer))
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Cause.NoSuchElementException)
    }),
  )
})
