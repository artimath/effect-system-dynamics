import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { simulateEager } from "../../src/Simulation.js"
import { Solver } from "../../src/Solver.js"
import { EquationEvaluator } from "../../src/Equations.js"
import { UnitManager } from "../../src/Units.js"
import { buildPredatorPreyModel } from "../../examples/predator-prey-model.js"

const layer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.RK4)


describe("Lotka-Volterra integration", () => {
  it.effect("produces oscillating predator-prey dynamics", () =>
    Effect.gen(function* () {
      const model = buildPredatorPreyModel()
      const states = yield* simulateEager(model)

      expect(states.length).toBeGreaterThan(0)
      const preySeries = states.map((state) => state.stocks[model.stocks[0]!.id] ?? 0)
      const predatorSeries = states.map((state) => state.stocks[model.stocks[1]!.id] ?? 0)

      expect(Math.min(...preySeries)).toBeGreaterThan(0)
      expect(Math.min(...predatorSeries)).toBeGreaterThan(0)
      expect(preySeries.some((value) => value !== preySeries[0]!)).toBe(true)
      expect(predatorSeries.some((value) => value !== predatorSeries[0]!)).toBe(true)
    }).pipe(Effect.provide(layer)),
  )
})
