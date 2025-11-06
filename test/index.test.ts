import { describe, it, expect } from "vitest"
import * as SystemDynamics from "../src/index.js"

describe("public API export surface", () => {
  it("exposes core modules", () => {
    expect(SystemDynamics).toHaveProperty("SimState")
    expect(SystemDynamics).toHaveProperty("simulate")
    expect(SystemDynamics).toHaveProperty("simulateEager")
    expect(SystemDynamics).toHaveProperty("simulateFinal")
    expect(SystemDynamics).toHaveProperty("Solver")
    expect(SystemDynamics).toHaveProperty("ConvergenceError")
    expect(SystemDynamics).toHaveProperty("Stock")
    expect(SystemDynamics).toHaveProperty("StockId")
  })
})
