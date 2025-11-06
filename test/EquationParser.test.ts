import { describe, it, expect } from "@effect/vitest"
import { parseEquationAst } from "../src/internal/equations/v2/Parser.js"
import type {
  BinaryNode,
  CallNode,
  EquationNode,
  Expr,
  QuantityLiteralNode,
} from "../src/internal/equations/v2/Ast.js"

const isQuantityLiteral = (expr: Expr): expr is QuantityLiteralNode => expr._tag === "QuantityLiteral"
const isBinary = (expr: Expr): expr is BinaryNode => expr._tag === "Binary"
const isCall = (expr: Expr): expr is CallNode => expr._tag === "Call"

const rootExpr = (source: string): Expr => {
  const equation: EquationNode = parseEquationAst(source)
  return equation.expr
}

describe("EquationParser", () => {
  it("parses numeric literal", () => {
    const expr = rootExpr("42")
    expect(isQuantityLiteral(expr)).toBe(true)
    if (isQuantityLiteral(expr)) {
      expect(expr.value).toBe(42)
    }
  })

  it("parses references", () => {
    const expr = rootExpr("[Population]")
    expect(expr._tag).toBe("Ref")
    if (expr._tag === "Ref") {
      expect(expr.name).toBe("Population")
    }
  })

  it("parses simple addition", () => {
    const expr = rootExpr("[Population] + 5")
    expect(isBinary(expr)).toBe(true)
    if (isBinary(expr)) {
      expect(expr.op).toBe("+")
      expect(expr.left._tag).toBe("Ref")
      expect(isQuantityLiteral(expr.right)).toBe(true)
    }
  })

  it("parses nested arithmetic", () => {
    const expr = rootExpr("1 + 2 * 3")
    expect(isBinary(expr)).toBe(true)
    if (isBinary(expr)) {
      expect(expr.op).toBe("+")
      expect(isQuantityLiteral(expr.left)).toBe(true)
      expect(isBinary(expr.right)).toBe(true)
    }
  })

  it("parses function call", () => {
    const expr = rootExpr("max([A], [B])")
    expect(isCall(expr)).toBe(true)
    if (isCall(expr)) {
      expect(expr.name).toBe("max")
      expect(expr.args).toHaveLength(2)
    }
  })
})
