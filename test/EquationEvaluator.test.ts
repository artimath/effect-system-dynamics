import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { EquationEvaluator } from "../src/Equations.js"

describe("EquationEvaluator", () => {
  const evaluate = (expression: string, scope: Record<string, number> = {}) =>
    Effect.gen(function* () {
      const evaluator = yield* EquationEvaluator
      return yield* evaluator.evaluate(expression, scope)
    })

  const withEvaluator = EquationEvaluator.layer

  it.effect("evaluates numeric literals and arithmetic", () =>
    Effect.gen(function* () {
      const result = yield* evaluate("1 + 2 * 3")
      expect(result).toBeCloseTo(7)
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("supports math functions", () =>
    Effect.gen(function* () {
      const result = yield* evaluate("sin(0)")
      expect(result).toBeCloseTo(0)

      const maxResult = yield* evaluate("max(1, 5, 3)")
      expect(maxResult).toBe(5)
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("resolves stock references from scope", () =>
    Effect.gen(function* () {
      const result = yield* evaluate("[Population] + 5", { Population: 10 })
      expect(result).toBe(15)
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("evaluates relational expressions", () =>
    Effect.gen(function* () {
      const greater = yield* evaluate("5 > 2")
      expect(greater).toBe(1)

      const equal = yield* evaluate("3 == 4")
      expect(equal).toBe(0)

      const logical = yield* evaluate("(1 > 0) && (2 < 3)")
      expect(logical).toBe(1)
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("rejects dimensional results", () =>
    Effect.gen(function* () {
      const exit = yield* evaluate("{ 5 sales }", {}).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("fails on missing identifiers", () =>
    Effect.gen(function* () {
      const exit = yield* evaluate("[Missing]", {}).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(withEvaluator)),
  )

  it.effect("reports syntax errors", () =>
    Effect.gen(function* () {
      const exit = yield* evaluate("1 +", {}).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(withEvaluator)),
  )
})
