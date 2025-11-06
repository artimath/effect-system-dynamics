import { Data } from "effect"

export class EquationParseError extends Data.TaggedError("EquationParseError")<{
  readonly expression: string
  readonly line: number
  readonly column: number
  readonly snippet: string
  readonly problem: string
}> {
  override get message(): string {
    return `Equation parse error at line ${this.line}, column ${this.column}: ${this.problem}`
  }
}

export class EquationEvaluationError extends Data.TaggedError("EquationEvaluationError")<{
  readonly expression: string
  readonly problem: string
}> {
  override get message(): string {
    return `Equation evaluation error: ${this.problem}`
  }
}
