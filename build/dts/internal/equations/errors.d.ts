declare const EquationParseError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "EquationParseError";
} & Readonly<A>;
export declare class EquationParseError extends EquationParseError_base<{
    readonly expression: string;
    readonly line: number;
    readonly column: number;
    readonly snippet: string;
    readonly problem: string;
}> {
    get message(): string;
}
declare const EquationEvaluationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "EquationEvaluationError";
} & Readonly<A>;
export declare class EquationEvaluationError extends EquationEvaluationError_base<{
    readonly expression: string;
    readonly problem: string;
}> {
    get message(): string;
}
export {};
//# sourceMappingURL=errors.d.ts.map