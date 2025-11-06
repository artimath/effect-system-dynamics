import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { ConvergenceError, InvalidTimeStepError, SolverTypeId } from "../src/Errors.js"
import { ModelId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)

describe("Solver error hierarchy", () => {
  it("exposes a stable solver type id", () => {
    expect(typeof SolverTypeId).toBe("symbol")
    expect(SolverTypeId.description).toBe("@org/effect-system-dynamics/Solver")
  })

  it("formats convergence error message", () => {
    const error = new ConvergenceError({
      model: decodeModelId("550e8400-e29b-41d4-a716-446655440000"),
      timeStep: 42,
      error: 1e-6,
    })

    expect(error.message).toBe(`Solver failed to converge at t=42: error=${1e-6}`)
  })

  it("formats invalid timestep message", () => {
    const error = new InvalidTimeStepError({ dt: 0, min: 1e-6, max: 1 })

    expect(error.message).toBe(`Invalid timestep 0: must be between ${1e-6} and 1`)
  })

  it.effect("supports catchTag on InvalidTimeStepError", () =>
    Effect.gen(function* () {
      const handled = yield* Effect.fail(new InvalidTimeStepError({ dt: 0, min: 1e-6, max: 1 })).pipe(
        Effect.catchTag("InvalidTimeStepError", (error) => {
          expect(error.dt).toBe(0)
          expect(error.min).toBeCloseTo(1e-6)
          expect(error.max).toBe(1)
          return Effect.succeed("handled")
        }),
      )

      expect(handled).toBe("handled")
    }),
  )

  it.effect("supports catchTag on ConvergenceError", () =>
    Effect.gen(function* () {
      const model = decodeModelId("660e8400-e29b-41d4-a716-446655440001")

      const handled = yield* Effect.fail(new ConvergenceError({ model, timeStep: 5, error: 0.05 })).pipe(
        Effect.catchTag("ConvergenceError", (error) => {
          expect(error.model).toBe(model)
          expect(error.timeStep).toBe(5)
          expect(error.error).toBeCloseTo(0.05)
          return Effect.succeed("handled")
        }),
      )

      expect(handled).toBe("handled")
    }),
  )
})
