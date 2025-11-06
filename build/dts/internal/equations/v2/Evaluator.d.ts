import { DelayStateStore } from "./DelayState.js";
import { Quantity } from "../Quantity.js";
import type { EquationNode } from "./Ast.js";
type Scope = Readonly<Record<string, Quantity>>;
export interface EvaluationOptions {
    readonly delayState?: DelayStateStore;
    readonly commit?: boolean;
}
export declare const evaluateEquationAst: (equation: EquationNode, scope: Scope, source: string, options?: EvaluationOptions) => Quantity;
export {};
//# sourceMappingURL=Evaluator.d.ts.map