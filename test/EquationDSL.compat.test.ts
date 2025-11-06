import { describe, expect, it } from "@effect/vitest"
import { EquationDsl } from "../src/Equations.js"

const simulationSyntaxSamples = [
  // Borrowed from simulation/test/suites/equations.test.js
  "2 + 2",
  "IF [Inventory] > 0 THEN 1 ELSE 0 END IF",
  "LOOKUP([ScaledTime], (0, 0) (1, 10) (2, 20))",
  "DELAY1([Inflow], { 2 tick }, { 0 widgets })",
  "FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nGain([Stock])",
]

describe("Equation DSL v2 compatibility", () => {
  it("parses simulation fixtures without diagnostics", () => {
    for (const sample of simulationSyntaxSamples) {
      expect(() => EquationDsl.parseEquationAst(sample)).not.toThrow()
    }
  })

  it("evaluates representative expressions compatible with reference models", () => {
    const common = {
      ScaledTime: EquationDsl.unitlessQuantity(0.25),
      Stock: EquationDsl.makeQuantity(15, { widgets: 1 }),
      Rate: EquationDsl.unitlessQuantity(0.5),
      Inventory: EquationDsl.makeQuantity(12, { widgets: 1 }),
      Inflow: EquationDsl.makeQuantity(10, { widgets: 1 }),
      "TIME STEP": EquationDsl.makeQuantity(1, { tick: 1 }),
    }

    const lookupSrc = "LOOKUP([ScaledTime], (0, 0) (1, 10))"
    const lookupAst = EquationDsl.parseEquationAst(lookupSrc)
    const lookupResult = EquationDsl.evaluateEquationAst(lookupAst, common, lookupSrc)
    expect(lookupResult.value).toBeCloseTo(2.5)
    expect(lookupResult.units).toEqual({})

    const branchSrc = "IF [Inventory] > { 10 widgets } THEN { 1 widgets } ELSE { 0 widgets } END IF"
    const branchAst = EquationDsl.parseEquationAst(branchSrc)
    const branchResult = EquationDsl.evaluateEquationAst(branchAst, common, branchSrc)
    expect(branchResult.value).toBeCloseTo(1)
    expect(branchResult.units).toEqual({ widgets: 1 })

    const macroSrc = "FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nGain([Stock])"
    const macroAst = EquationDsl.parseEquationAst(macroSrc)
    const macroResult = EquationDsl.evaluateEquationAst(macroAst, common, macroSrc)
    expect(macroResult.value).toBeCloseTo(7.5)
    expect(macroResult.units).toEqual({ widgets: 1 })

    const delaySrc = "DELAY1([Inflow], { 2 tick }, { 0 widgets })"
    const delayAst = EquationDsl.parseEquationAst(delaySrc)
    const delayState = new EquationDsl.DelayStateStore()

    const firstDelay = EquationDsl.evaluateEquationAst(delayAst, common, delaySrc, {
      delayState,
    })
    expect(firstDelay.value).toBeCloseTo(5)
    expect(firstDelay.units).toEqual({ widgets: 1 })

    const updatedScope = {
      ...common,
      Inflow: EquationDsl.makeQuantity(20, { widgets: 1 }),
    }
    const secondDelay = EquationDsl.evaluateEquationAst(delayAst, updatedScope, delaySrc, {
      delayState,
    })
    expect(secondDelay.value).toBeCloseTo(12.5)
    expect(secondDelay.units).toEqual({ widgets: 1 })
  })
})
