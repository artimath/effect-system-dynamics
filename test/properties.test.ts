import { describe, it } from "@effect/vitest"
import { Arbitrary, Effect, Layer, Schema } from "effect"
import * as FastCheck from "effect/FastCheck"
import type { TestServices } from "effect/TestServices"
import { Model, Stock, TimeConfig } from "../src/Model.js"
import { Solver } from "../src/Solver.js"
import { simulateEager, simulateFinal } from "../src/Simulation.js"
import { EquationEvaluator } from "../src/Equations.js"
import { UnitManager } from "../src/Units.js"
import { ModelId, StockId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)

const StockSample = Schema.Struct({
  id: StockId,
  name: Schema.NonEmptyTrimmedString,
  initialValue: Schema.Number.pipe(Schema.nonNaN(), Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(1_000)),
})

const ModelSample = Schema.Struct({
  id: ModelId,
  name: Schema.NonEmptyTrimmedString,
  stocks: Schema.Array(StockSample).pipe(Schema.minItems(1), Schema.maxItems(4)),
  steps: Schema.Int.pipe(Schema.greaterThanOrEqualTo(5), Schema.lessThanOrEqualTo(80)),
  stepSize: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0.05), Schema.lessThanOrEqualTo(1)),
})

const modelArbitrary = Arbitrary.make(ModelSample).map(({ id, name, stocks, steps, stepSize }) => {
  const decodedStocks = stocks.map((stockValue) =>
    new Stock({
      ...stockValue,
      id: decodeStockId(stockValue.id),
      initialValue: Number(stockValue.initialValue.toFixed(2)),
    }),
  )
  const step = Number(stepSize.toFixed(2))
  const end = Number((step * steps).toFixed(2))

  return new Model({
    id: decodeModelId(id),
    name,
    stocks: decodedStocks,
    flows: [],
    variables: [],
    timeConfig: new TimeConfig({ start: 0, end, step }),
  })
})

const assertAsyncProperty = <Args extends Array<unknown>>(
  property: FastCheck.IAsyncProperty<Args>,
) =>
  Effect.tryPromise({
    try: async () => {
      await Promise.resolve(FastCheck.assert(property, { numRuns: 50 }))
    },
    catch: (error) => error as Error,
  })

const solverLayer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.Euler)

describe("simulation properties", () => {
  it.effect("time is monotonic and length matches horizon", () =>
    assertAsyncProperty(
      FastCheck.asyncProperty(modelArbitrary, async (model) => {
        const states = await Effect.runPromise(
          simulateEager(model).pipe(Effect.provide(solverLayer))
        )

        if (states.length === 0) {
          throw new Error("simulation emitted no states")
        }

        for (let i = 1; i < states.length; i++) {
          const current = states[i]!
          const previous = states[i - 1]!
          if (current.time < previous.time) {
            throw new Error(`time regressed from ${previous.time} to ${current.time}`)
          }
        }

        const first = states[0]!
        const last = states.at(-1)!

        if (Math.abs(first.time - model.timeConfig.start) > 1e-6) {
          throw new Error(`stream did not start at t=${model.timeConfig.start}`)
        }

        if (Math.abs(last.time - model.timeConfig.end) > 1e-6) {
          throw new Error(
            `stream last time ${last.time} did not match horizon ${model.timeConfig.end}`
          )
        }
      })
    ).pipe(Effect.tap(() => Effect.context<TestServices>()))
  )

  it.effect("stocks remain non-negative", () =>
    assertAsyncProperty(
      FastCheck.asyncProperty(modelArbitrary, async (model) => {
        const states = await Effect.runPromise(
          simulateEager(model).pipe(Effect.provide(solverLayer))
        )

        for (const state of states) {
          for (const value of Object.values(state.stocks)) {
            if (value < 0) {
              throw new Error(`stock became negative: ${value}`)
            }
          }
        }
      })
    ).pipe(Effect.tap(() => Effect.context<TestServices>()))
  )

  it.effect("final state time matches horizon", () =>
    assertAsyncProperty(
      FastCheck.asyncProperty(modelArbitrary, async (model) => {
        const finalState = await Effect.runPromise(
          simulateFinal(model).pipe(Effect.provide(solverLayer))
        )

        if (Math.abs(finalState.time - model.timeConfig.end) > 1e-6) {
          throw new Error(
            `final time ${finalState.time} did not match horizon ${model.timeConfig.end}`
          )
        }
      })
    ).pipe(Effect.tap(() => Effect.context<TestServices>()))
  )
})
