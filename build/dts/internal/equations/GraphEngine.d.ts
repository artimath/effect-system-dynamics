import { Effect } from "effect";
import type { Variable } from "../../Model.js";
import { EquationEvaluationError } from "./errors.js";
import type { EquationEvaluationOptions } from "./EquationEngine.js";
import { Quantity } from "./Quantity.js";
import type { EquationNode } from "./v2/Ast.js";
declare const EquationGraphBuildError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "EquationGraphBuildError";
} & Readonly<A>;
export declare class EquationGraphBuildError extends EquationGraphBuildError_base<{
    readonly reason: string;
}> {
}
declare const EquationGraphCycleError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "EquationGraphCycleError";
} & Readonly<A>;
export declare class EquationGraphCycleError extends EquationGraphCycleError_base<{
    readonly nodes: ReadonlyArray<string>;
}> {
}
export interface CompiledEquationGraph {
    readonly order: ReadonlyArray<string>;
    readonly variablesById: ReadonlyMap<string, Variable>;
    readonly tokenToVariable: ReadonlyMap<string, Variable>;
    readonly constants: ReadonlyArray<Variable>;
    readonly astById: ReadonlyMap<string, EquationNode>;
    readonly sourceById: ReadonlyMap<string, string>;
}
export declare const compileEquationGraph: (variables: ReadonlyArray<Variable>) => Effect.Effect<CompiledEquationGraph, EquationGraphBuildError | EquationGraphCycleError>;
export declare const evaluateEquationGraph: (compiled: CompiledEquationGraph, scope: Record<string, Quantity>, options?: EquationEvaluationOptions) => Effect.Effect<{
    readonly values: Record<string, number>;
    readonly units: Record<string, Record<string, number>>;
    readonly scope: Record<string, Quantity>;
}, EquationEvaluationError>;
export {};
//# sourceMappingURL=GraphEngine.d.ts.map