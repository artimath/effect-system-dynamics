import { EquationEvaluationError, EquationParseError } from "./errors.js"
import { UnitMap } from "./Quantity.js"
import { evaluateEquationAst, type EvaluationOptions } from "./v2/Evaluator.js"
import { EquationDiagnosticError } from "./v2/Diagnostic.js"
import { parseEquationAst } from "./v2/Parser.js"
import { parseUnitExpression } from "./v2/UnitParser.js"

type Scope = Readonly<Record<string, import("./Quantity.js").Quantity>>

export type EquationEvaluationOptions = EvaluationOptions

const createSnippet = (source: string, line: number, column: number): string => {
  const lines = source.split(/\r?\n/)
  const target = lines[Math.max(0, line - 1)] ?? ""
  const caretIndex = Math.max(0, column - 1)
  return `${target}\n${" ".repeat(caretIndex)}^`
}

const toParseError = (expression: string, diagnostic: EquationDiagnosticError): EquationParseError => {
  const span = diagnostic.diagnostic.span
  const line = span?.line ?? 1
  const column = span?.column ?? 1
  const snippet = diagnostic.diagnostic.snippet ?? createSnippet(expression, line, column)
  return new EquationParseError({
    expression,
    line,
    column,
    problem: diagnostic.diagnostic.message,
    snippet,
  })
}

export const evaluateEquation = (
  expression: string,
  scope: Scope,
  options?: EquationEvaluationOptions,
) => {
  try {
    const ast = parseEquationAst(expression)
    return evaluateEquationAst(ast, scope, expression, options)
  } catch (error) {
    if (error instanceof EquationDiagnosticError) {
      throw toParseError(expression, error)
    }
    if (error instanceof EquationParseError || error instanceof EquationEvaluationError) {
      throw error
    }
    throw new EquationEvaluationError({
      expression,
      problem: error instanceof Error ? error.message : String(error),
    })
  }
}

export const parseUnitsLiteral = (units: string): UnitMap => {
  if (units.trim().length === 0) {
    return Object.create(null)
  }
  try {
    return parseUnitExpression(units, 0)
  } catch (error) {
    if (error instanceof EquationDiagnosticError) {
      throw new EquationParseError({
        expression: units,
        line: error.diagnostic.span?.line ?? 1,
        column: error.diagnostic.span?.column ?? 1,
        problem: error.diagnostic.message,
        snippet: error.diagnostic.snippet ?? createSnippet(units, 1, 1),
      })
    }
    throw new EquationParseError({
      expression: units,
      line: 1,
      column: 1,
      problem: error instanceof Error ? error.message : String(error),
      snippet: createSnippet(units, 1, 1),
    })
  }
}
