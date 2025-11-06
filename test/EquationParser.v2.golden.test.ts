import { describe, expect, it } from "@effect/vitest"
import { pipe } from "effect/Function"
import { parseEquationAst } from "../src/internal/equations/v2/Parser.js"
import { printEquation } from "../src/internal/equations/v2/Pretty.js"
import type { EquationNode, Expr } from "../src/internal/equations/v2/Ast.js"

/**
 * Helper to drop volatile metadata so comparisons focus on structure.
 */
const stripEquation = (equation: EquationNode): unknown => ({
  defs: equation.defs.map(stripFunction),
  expr: stripExpr(equation.expr),
})

const stripFunction = (fn: EquationNode["defs"][number]): unknown => ({
  name: fn.name,
  params: fn.params,
  body: stripExpr(fn.body),
})

const stripExpr = (expr: Expr): unknown => {
  switch (expr._tag) {
    case "QuantityLiteral":
      return { _tag: expr._tag, value: expr.value, unit: expr.unit }
    case "BooleanLiteral":
      return { _tag: expr._tag, value: expr.value }
    case "Ref":
      return { _tag: expr._tag, name: expr.name }
    case "Unary":
      return { _tag: expr._tag, op: expr.op, expr: stripExpr(expr.expr) }
    case "Binary":
      return {
        _tag: expr._tag,
        op: expr.op,
        left: stripExpr(expr.left),
        right: stripExpr(expr.right),
      }
    case "Call":
      return { _tag: expr._tag, name: expr.name, args: expr.args.map(stripExpr) }
    case "Lookup1D":
      return {
        _tag: expr._tag,
        x: stripExpr(expr.x),
        points: expr.points,
        xUnit: expr.xUnit,
        yUnit: expr.yUnit,
      }
    case "Delay":
      return {
        _tag: expr._tag,
        kind: expr.kind,
        input: stripExpr(expr.input),
        tau: stripExpr(expr.tau),
        init: expr.init ? stripExpr(expr.init) : undefined,
      }
    case "Time":
      return { _tag: expr._tag, kind: expr.kind }
    case "IfChain":
      return {
        _tag: expr._tag,
        branches: expr.branches.map((branch) => ({
          cond: stripExpr(branch.cond),
          then: stripExpr(branch.then),
        })),
        elseBranch: expr.elseBranch ? stripExpr(expr.elseBranch) : undefined,
      }
  }
}

describe("Equation DSL v2 parser golden suite", () => {
  const cases = [
    {
      name: "arithmetic precedence",
      source: "10 + 5 * 3 - 2",
    },
    {
      name: "unit literal",
      source: "9.81 { m / s^2 }",
    },
    {
      name: "reference with spaces",
      source: "[Net Stock Inflow]",
    },
    {
      name: "boolean and unary",
      source: "NOT (TRUE AND FALSE)",
    },
    {
      name: "conditional chain",
      source: "IF [Population] > 0 THEN 1 ELSEIF [Population] < 0 THEN -1 ELSE 0 END IF",
    },
    {
      name: "lookup literal",
      source: "LOOKUP(Time, (0, 0) (10, 100) (20, 400))",
    },
    {
      name: "delay with init",
      source: "DELAY3([Inflow], 5 { day }, [Initial])",
    },
    {
      name: "time primitives",
      source: "TIME STEP + INITIAL TIME + FINAL TIME",
    },
    {
      name: "macro definition",
      source: `FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nGain([Stocks])`,
    },
  ] as const

  it.each(cases)("parses %s", ({ source }) => {
    const equation = parseEquationAst(source)
    expect(stripEquation(equation)).toMatchSnapshot()
  })

  it.each(cases)("round-trips %s", ({ source, name }) => {
    const equation = parseEquationAst(source)
    const printed = printEquation(equation)
    const reparsed = parseEquationAst(printed)
    expect(stripEquation(reparsed)).toEqual(stripEquation(equation))
  })

  it("pretty printer emits canonical macro definitions", () => {
    const source = `FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nGain([Stocks])`
    const canonical = pipe(source, parseEquationAst, printEquation)
    expect(canonical).toMatchInlineSnapshot(`
      "FUNCTION Gain(x)
        (x * Rate)
      END FUNCTION

      Gain(Stocks)"
    `)
  })
})
