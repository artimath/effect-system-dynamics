import { describe, it, expect } from "vitest"
import { makePopulationModel, makePredatorPreyModel, makeSIRModel } from "./fixtures.js"

describe("test fixtures", () => {
  it("builds a population growth model", () => {
    const model = makePopulationModel()

    expect(model.name).toBe("Population Growth")
    expect(model.stocks).toHaveLength(1)
    expect(model.flows).toHaveLength(1)
    expect(model.variables).toHaveLength(1)
    expect(model.timeConfig.step).toBe(1)
  })

  it("builds an SIR epidemic model", () => {
    const model = makeSIRModel()

    expect(model.stocks).toHaveLength(3)
    expect(model.flows).toHaveLength(2)
    expect(model.variables).toHaveLength(2)
    expect(model.timeConfig.end).toBe(160)
  })

  it("builds a predator prey model", () => {
    const model = makePredatorPreyModel()

    expect(model.stocks).toHaveLength(2)
    expect(model.flows).toHaveLength(3)
    expect(model.timeConfig.step).toBeCloseTo(0.5)
  })
})
