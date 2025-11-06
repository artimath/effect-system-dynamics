import { Data } from "effect"

/**
 * Structured diagnostic surfaced by the v2 Equation DSL pipeline. The
 * `EquationDiagnosticError` wrapper allows the parser to integrate with
 * existing Effect error-handling patterns while still exposing the rich
 * payload.
 */
export type EquationPhase = "parse" | "compile" | "evaluate"

export type EquationErrorCode =
  | "UnexpectedToken"
  | "UnclosedBlock"
  | "TrailingInput"
  | "UnterminatedString"
  | "InvalidUnitExponent"
  | "InvalidUnitToken"
  | "UnknownKeyword"
  | "MacroRecursion"
  | "MacroImpureBody"
  | "DuplicateMacroName"
  | "InvalidElseIfChain"
  | "LookupNonMonotonic"
  | "LookupEmpty"
  | "IdentifierNotFound"
  | "UnitMismatch"
  | "NonIntegerExponent"
  | "DimensionlessRequired"
  | "UnsupportedOperator"
  | "UnsupportedFunction"
  | "DelayInvalidTau"
  | "StateAccessError"
  | "ComparisonUnitMismatch"
  | "EqualityUnitMismatch"

export interface Span {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
}

export interface EquationDiagnostic {
  readonly phase: EquationPhase
  readonly code: EquationErrorCode
  readonly message: string
  readonly span?: Span
  readonly snippet?: string
  readonly hints?: ReadonlyArray<string>
  readonly meta?: Record<string, unknown>
}

export class EquationDiagnosticError extends Data.TaggedError("EquationDiagnosticError")<{
  readonly diagnostic: EquationDiagnostic
}> {
  override get message(): string {
    return this.diagnostic.message
  }
}

