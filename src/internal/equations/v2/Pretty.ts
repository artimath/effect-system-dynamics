import type {
  BinaryNode,
  CallNode,
  DelayNode,
  EquationNode,
  Expr,
  FunctionDefNode,
  IfChainNode,
  Lookup1DNode,
  QuantityLiteralNode,
  ReferenceNode,
  TimeNode,
  UnaryNode,
} from "./Ast.js"
import type { UnitMap } from "../Quantity.js"

/**
 * Minimal pretty-printer used for golden round-trip tests. The output is not
 * intended for direct user-facing display, but it is stable and unambiguous so
 * AST snapshots can be regenerated deterministically.
 */

export const printEquation = (equation: EquationNode): string => {
  const defs = equation.defs.map(printFunction).join("\n\n")
  const body = printExpr(equation.expr)
  return defs.length > 0 ? `${defs}\n\n${body}` : body
}

const printFunction = (fn: FunctionDefNode): string => {
  const params = fn.params.join(", ")
  const body = printExpr(fn.body)
  return `FUNCTION ${fn.name}(${params})\n  ${body}\nEND FUNCTION`
}

const printExpr = (expr: Expr): string => {
  switch (expr._tag) {
    case "QuantityLiteral":
      return printQuantity(expr)
    case "BooleanLiteral":
      return expr.value ? "TRUE" : "FALSE"
    case "Ref":
      return printReference(expr)
    case "Unary":
      return printUnary(expr)
    case "Binary":
      return printBinary(expr)
    case "Call":
      return printCall(expr)
    case "Lookup1D":
      return printLookup(expr)
    case "Delay":
      return printDelay(expr)
    case "Time":
      return printTime(expr)
    case "IfChain":
      return printIfChain(expr)
    default:
      return "<unknown>"
  }
}

const printQuantity = (literal: QuantityLiteralNode): string => {
  const value = literal.value.toString()
  if (!literal.unit || Object.keys(literal.unit).length === 0) {
    return value
  }
  return `${value} { ${printUnitMap(literal.unit)} }`
}

const printReference = (ref: ReferenceNode): string => ref.name.includes(" ") ? `[${ref.name}]` : ref.name

const printUnary = (node: UnaryNode): string => {
  const op = node.op === "Not" ? "NOT" : node.op === "Neg" ? "-" : "+"
  const expr = printExpr(node.expr)
  return `${op} ${expr}`
}

const printBinary = (node: BinaryNode): string => {
  const left = printExpr(node.left)
  const right = printExpr(node.right)
  const op = node.op === "AND" || node.op === "OR" || node.op === "XOR" ? node.op : node.op
  return `(${left} ${op} ${right})`
}

const printCall = (call: CallNode): string => {
  const args = call.args.map(printExpr).join(", ")
  return `${call.name}(${args})`
}

const printLookup = (lookup: Lookup1DNode): string => {
  const x = printExpr(lookup.x)
  const table = lookup.points.map((point) => `(${point.x}, ${point.y})`).join(" ")
  return `LOOKUP(${x}, ${table})`
}

const printDelay = (delay: DelayNode): string => {
  const args = [printExpr(delay.input), printExpr(delay.tau)]
  if (delay.init) {
    args.push(printExpr(delay.init))
  }
  return `${delay.kind}(${args.join(", ")})`
}

const printTime = (time: TimeNode): string => {
  switch (time.kind) {
    case "TIME":
      return "TIME"
    case "TIME_STEP":
      return "TIME STEP"
    case "INITIAL_TIME":
      return "INITIAL TIME"
    case "FINAL_TIME":
      return "FINAL TIME"
  }
}

const printIfChain = (node: IfChainNode): string => {
  const parts: Array<string> = []
  const first = node.branches[0]
  if (first) {
    parts.push(`IF ${printExpr(first.cond)} THEN ${printExpr(first.then)}`)
  }
  const rest = node.branches.slice(1)
  for (const branch of rest) {
    parts.push(`ELSEIF ${printExpr(branch.cond)} THEN ${printExpr(branch.then)}`)
  }
  if (node.elseBranch) {
    parts.push(`ELSE ${printExpr(node.elseBranch)}`)
  }
  parts.push("END IF")
  return parts.join("\n")
}

const printUnitMap = (unit: UnitMap): string => {
  const entries = Object.keys(unit).sort()
  return entries
    .map((name) => {
      const exponent = unit[name] ?? 0
      if (Math.abs(exponent - 1) < 1e-12) {
        return name
      }
      return `${name}^${exponent}`
    })
    .join(" * ")
}
