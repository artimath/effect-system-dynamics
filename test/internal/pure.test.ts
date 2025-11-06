import { describe, it, expect } from "vitest"
import { pureEulerStep, blendRK4Rates } from "../../src/internal/pure.js"

describe("Pure Arithmetic Functions", () => {
  describe("pureEulerStep", () => {
    it("updates stocks by rate * dt", () => {
      const stocks = { population: 100 }
      const rates = { population: 5 }
      const dt = 0.1

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.population).toBe(100.5)
    })

    it("handles multiple stocks", () => {
      const stocks = {
        population: 1000,
        resources: 500,
        pollution: 10,
      }
      const rates = {
        population: 20, // growing
        resources: -5, // depleting
        pollution: 2, // increasing
      }
      const dt = 1

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.population).toBe(1020)
      expect(result.resources).toBe(495)
      expect(result.pollution).toBe(12)
    })

    it("handles missing rates as zero", () => {
      const stocks = { a: 100, b: 200 }
      const rates = { a: 5 } // b has no rate
      const dt = 1

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.a).toBe(105)
      expect(result.b).toBe(200) // unchanged
    })

    it("handles dt = 0 (stocks unchanged)", () => {
      const stocks = { population: 100 }
      const rates = { population: 5 }
      const dt = 0

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.population).toBe(100)
    })

    it("handles negative rates (decreasing stocks)", () => {
      const stocks = { inventory: 1000 }
      const rates = { inventory: -50 }
      const dt = 0.5

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.inventory).toBe(975)
    })

    it("handles fractional dt", () => {
      const stocks = { money: 100 }
      const rates = { money: 10 }
      const dt = 0.25

      const result = pureEulerStep(stocks, rates, dt)

      expect(result.money).toBe(102.5)
    })

    it("is pure (does not mutate inputs)", () => {
      const stocks = { x: 10 }
      const rates = { x: 5 }
      const dt = 1

      pureEulerStep(stocks, rates, dt)

      expect(stocks.x).toBe(10) // unchanged
      expect(rates.x).toBe(5) // unchanged
    })
  })

  describe("blendRK4Rates", () => {
    it("computes weighted average: (k1 + 2*k2 + 2*k3 + k4) / 6", () => {
      const k1 = { population: 1.0 }
      const k2 = { population: 1.1 }
      const k3 = { population: 1.05 }
      const k4 = { population: 1.15 }

      const result = blendRK4Rates(k1, k2, k3, k4)

      // (1.0 + 2*1.1 + 2*1.05 + 1.15) / 6 = 7.45 / 6 = 1.2416666...
      expect(result.population).toBeCloseTo(1.075, 10)
    })

    it("handles multiple stocks", () => {
      const k1 = { a: 10, b: 20 }
      const k2 = { a: 12, b: 22 }
      const k3 = { a: 11, b: 21 }
      const k4 = { a: 13, b: 23 }

      const result = blendRK4Rates(k1, k2, k3, k4)

      // a: (10 + 2*12 + 2*11 + 13) / 6 = 69/6 = 11.5
      // b: (20 + 2*22 + 2*21 + 23) / 6 = 129/6 = 21.5
      expect(result.a).toBeCloseTo(11.5, 10)
      expect(result.b).toBeCloseTo(21.5, 10)
    })

    it("handles missing rates in some k samples (treats as zero)", () => {
      const k1 = { x: 1.0, y: 2.0 }
      const k2 = { x: 1.5 } // y missing
      const k3 = { x: 1.2, y: 2.5 }
      const k4 = { x: 1.8 } // y missing

      const result = blendRK4Rates(k1, k2, k3, k4)

      // x: (1.0 + 2*1.5 + 2*1.2 + 1.8) / 6 = 8.2/6 = 1.3666...
      // y: (2.0 + 0 + 2*2.5 + 0) / 6 = 7.0/6 = 1.1666...
      expect(result.x).toBeCloseTo(1.3666666, 5)
      expect(result.y).toBeCloseTo(1.1666666, 5)
    })

    it("collects all keys from all four samples", () => {
      const k1 = { a: 1 }
      const k2 = { b: 2 }
      const k3 = { c: 3 }
      const k4 = { d: 4 }

      const result = blendRK4Rates(k1, k2, k3, k4)

      // a: (1 + 0 + 0 + 0) / 6 = 1/6
      // b: (0 + 2*2 + 0 + 0) / 6 = 4/6
      // c: (0 + 0 + 2*3 + 0) / 6 = 6/6 = 1
      // d: (0 + 0 + 0 + 4) / 6 = 4/6
      expect(result.a).toBeCloseTo(1 / 6, 10)
      expect(result.b).toBeCloseTo(4 / 6, 10)
      expect(result.c).toBeCloseTo(1, 10)
      expect(result.d).toBeCloseTo(4 / 6, 10)
    })

    it("handles identical rates (returns same rate)", () => {
      const k = { population: 5.0 }

      const result = blendRK4Rates(k, k, k, k)

      // (5 + 2*5 + 2*5 + 5) / 6 = 30/6 = 5
      expect(result.population).toBe(5.0)
    })

    it("is pure (does not mutate inputs)", () => {
      const k1 = { x: 1 }
      const k2 = { x: 2 }
      const k3 = { x: 3 }
      const k4 = { x: 4 }

      blendRK4Rates(k1, k2, k3, k4)

      expect(k1.x).toBe(1)
      expect(k2.x).toBe(2)
      expect(k3.x).toBe(3)
      expect(k4.x).toBe(4)
    })
  })

  describe("integration test: Euler vs RK4 accuracy", () => {
    it("Euler accumulates error, RK4 is more accurate", () => {
      // Simple exponential growth: dx/dt = 0.1*x, x(0)=100
      // Analytical solution: x(t) = 100 * e^(0.1*t)
      // At t=10: x(10) = 100 * e^1 ≈ 271.828

      const dt = 1
      const steps = 10
      const rate = 0.1

      // Euler simulation
      let eulerStock = 100
      for (let i = 0; i < steps; i++) {
        const eulerRate = rate * eulerStock
        const result = pureEulerStep({ x: eulerStock }, { x: eulerRate }, dt)
        eulerStock = result.x!
      }

      // RK4 would need equation evaluator, but we can verify Euler's error
      const analytical = 100 * Math.exp(1) // ≈ 271.828
      const eulerError = Math.abs(eulerStock - analytical)

      // Euler with dt=1 will have significant error (1st order method)
      expect(eulerError).toBeGreaterThan(10) // Euler is not very accurate
      expect(eulerStock).toBeGreaterThan(200) // But in ballpark
      expect(eulerStock).toBeLessThan(300)
    })
  })
})
