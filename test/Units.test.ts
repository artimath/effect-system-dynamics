import { describe, it, expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  UnitDefinition,
  UnitRegistry,
  UnitNotFoundError,
  UnitDimensionMismatchError,
  UnsupportedQuantityError,
  makeRegistry,
  extendRegistry,
  convertValue,
  convertQuantity,
  quantityFromUnit,
} from "../src/Units.js"
import { makeQuantity } from "../src/internal/equations/Quantity.js"

describe("Units module", () => {
  const decodeDefinition = Schema.decodeSync(UnitDefinition)

  const kilogram = decodeDefinition({
    symbol: "kg",
    dimension: { mass: 1 },
    factor: 1,
  })

  const gram = decodeDefinition({
    symbol: "g",
    dimension: { mass: 1 },
    factor: 0.001,
  })

  const meter = decodeDefinition({
    symbol: "m",
    dimension: { length: 1 },
    factor: 1,
  })

  const registry: UnitRegistry = makeRegistry([kilogram, gram, meter])

  it.effect("converts scalar values between compatible units", () =>
    Effect.gen(function* () {
      const value = yield* convertValue(registry, 5000, "g", "kg")
      expect(value).toBeCloseTo(5)
    }),
  )

  it.effect("fails when the target unit is unknown", () =>
    Effect.gen(function* () {
      const error = yield* convertValue(registry, 1, "kg", "unknown").pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnitNotFoundError)
    }),
  )

  it.effect("fails when units do not share a dimension", () =>
    Effect.gen(function* () {
      const error = yield* convertValue(registry, 1, "kg", "m").pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnitDimensionMismatchError)
    }),
  )

  it.effect("converts quantities with single-symbol units", () =>
    Effect.gen(function* () {
      const quantity = makeQuantity(2500, { g: 1 })
      const converted = yield* convertQuantity(registry, quantity, "kg")
      expect(converted.value).toBeCloseTo(2.5)
      expect(converted.units).toEqual({ kg: 1 })
    }),
  )

  it.effect("rejects composite quantities", () =>
    Effect.gen(function* () {
      const composite = makeQuantity(10, { kg: 1, m: 1 })
      const error = yield* convertQuantity(registry, composite, "kg").pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnsupportedQuantityError)
    }),
  )

  it.effect("materialises quantities from registered units", () =>
    Effect.gen(function* () {
      const quantity = yield* quantityFromUnit(registry, 42, "kg")
      expect(quantity.value).toBe(42)
      expect(quantity.units).toEqual({ kg: 1 })
    }),
  )

  it("extends registries immutably", () => {
    const second = decodeDefinition({
      symbol: "s",
      dimension: { time: 1 },
      factor: 1,
    })
    const extended = extendRegistry(registry, [second])
    expect(extended.units).toHaveLength(registry.units.length + 1)
    expect(registry.units).toHaveLength(3)
  })
})
