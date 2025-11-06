import { UnitMap } from "./Quantity.js";
import { type EvaluationOptions } from "./v2/Evaluator.js";
type Scope = Readonly<Record<string, import("./Quantity.js").Quantity>>;
export type EquationEvaluationOptions = EvaluationOptions;
export declare const evaluateEquation: (expression: string, scope: Scope, options?: EquationEvaluationOptions) => import("./Quantity.js").Quantity;
export declare const parseUnitsLiteral: (units: string) => UnitMap;
export {};
//# sourceMappingURL=EquationEngine.d.ts.map