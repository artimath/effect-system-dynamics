/**
 * Structured diagnostic surfaced by the v2 Equation DSL pipeline. The
 * `EquationDiagnosticError` wrapper allows the parser to integrate with
 * existing Effect error-handling patterns while still exposing the rich
 * payload.
 */
export type EquationPhase = "parse" | "compile" | "evaluate";
export type EquationErrorCode = "UnexpectedToken" | "UnclosedBlock" | "TrailingInput" | "UnterminatedString" | "InvalidUnitExponent" | "InvalidUnitToken" | "UnknownKeyword" | "MacroRecursion" | "MacroImpureBody" | "DuplicateMacroName" | "InvalidElseIfChain" | "LookupNonMonotonic" | "LookupEmpty" | "IdentifierNotFound" | "UnitMismatch" | "NonIntegerExponent" | "DimensionlessRequired" | "UnsupportedOperator" | "UnsupportedFunction" | "DelayInvalidTau" | "StateAccessError" | "ComparisonUnitMismatch" | "EqualityUnitMismatch";
export interface Span {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
}
export interface EquationDiagnostic {
    readonly phase: EquationPhase;
    readonly code: EquationErrorCode;
    readonly message: string;
    readonly span?: Span;
    readonly snippet?: string;
    readonly hints?: ReadonlyArray<string>;
    readonly meta?: Record<string, unknown>;
}
declare const EquationDiagnosticError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "EquationDiagnosticError";
} & Readonly<A>;
export declare class EquationDiagnosticError extends EquationDiagnosticError_base<{
    readonly diagnostic: EquationDiagnostic;
}> {
    get message(): string;
}
export {};
//# sourceMappingURL=Diagnostic.d.ts.map