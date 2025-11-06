import { describe, it, expect } from "vitest"
import { Effect, Schema } from "effect"

describe("effect-system-dynamics", () => {
  it("should be set up", () => {
    expect(true).toBe(true)
  })

  it("should import Effect types correctly", () => {
    // Smoke test: verify Effect imports work
    const program = Effect.succeed(42)
    expect(program).toBeDefined()
    expect(Schema.String).toBeDefined()
  })
})
