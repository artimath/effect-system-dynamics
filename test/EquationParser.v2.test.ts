import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"
import { printEquation } from "../src/internal/equations/v2/Pretty.js"
import type { EquationNode, Expr } from "../src/internal/equations/v2/Ast.js"
import { parseEquationAst, parseEquationEither } from "../src/internal/equations/v2/Parser.js"

describe("Equation DSL v2 parser", () => {
  it("parses arithmetic with precedence", () => {
    const equation = parseEquationAst("1 + 2 * 3")
    expect(equation.expr).toMatchObject({
      _tag: "Binary",
      op: "+",
      left: { _tag: "QuantityLiteral", value: 1 },
      right: {
        _tag: "Binary",
        op: "*",
        left: { _tag: "QuantityLiteral", value: 2 },
        right: { _tag: "QuantityLiteral", value: 3 },
      },
    })
  })

  it("parses units after literals", () => {
    const equation = parseEquationAst("9.81 { m / s^2 }")
    const literal = equation.expr
    expect(literal).toMatchObject({
      _tag: "QuantityLiteral",
      value: 9.81,
    })
    const unit = (literal as any).unit
    expect(unit).toEqual({ m: 1, s: -2 })
  })

  it("parses conditional chains", () => {
    const src = "IF [Stock] > 0 THEN 1 ELSE 2 END IF"
    const equation = parseEquationAst(src)
    expect(equation.expr).toMatchObject({
      _tag: "IfChain",
      branches: [{ cond: { _tag: "Binary", op: ">" }, then: { _tag: "QuantityLiteral", value: 1 } }],
      elseBranch: { _tag: "QuantityLiteral", value: 2 },
    })
  })

  it("parses lookup tables", () => {
    const src = "LOOKUP(Time, (0, 1) (1, 2))"
    const equation = parseEquationAst(src)
    const lookup = equation.expr
    expect(lookup).toMatchObject({
      _tag: "Lookup1D",
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ],
    })
  })

  it("parses delay primitives", () => {
    const src = "DELAY1([Inflow], 5, 0)"
    const equation = parseEquationAst(src)
    expect(equation.expr).toMatchObject({
      _tag: "Delay",
      kind: "DELAY1",
    })
  })

  it("parses macros", () => {
    const src = `FUNCTION Double(x)\n  x * 2\nEND FUNCTION\nDouble(3)`
    const equation = parseEquationAst(src)
    expect(equation.defs).toHaveLength(1)
    expect(equation.expr).toMatchObject({
      _tag: "Call",
      name: "Double",
    })
  })

  it("round-trips through pretty printer", () => {
    const src = `FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nIF Gain(Stocks) > 0 THEN TRUE ELSE FALSE END IF`
    const equation = parseEquationAst(src)
    const printed = printEquation(equation)
    const reparsed = parseEquationAst(printed)
    expect(stripEquation(equation)).toEqual(stripEquation(reparsed))
  })

  it("produces Either failures on lexical errors", () => {
    const result = parseEquationEither("1 + @")
    expect(Either.isLeft(result)).toBe(true)
  })
})

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
