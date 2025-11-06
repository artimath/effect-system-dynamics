import { Context, Effect, Layer } from "effect";
import { EquationEvaluationError, EquationParseError } from "./internal/equations/errors.js";
import * as EquationDslModule from "./internal/equations/v2/public.js";
export { EquationDslModule as EquationDsl };
export interface EquationEvaluatorService {
    readonly evaluate: (expression: string, scope?: Readonly<Record<string, number>>) => Effect.Effect<number, EquationParseError | EquationEvaluationError>;
}
declare const EquationEvaluator_base: Context.TagClass<EquationEvaluator, "@org/effect-system-dynamics/EquationEvaluator", EquationEvaluatorService>;
export declare class EquationEvaluator extends EquationEvaluator_base {
    static readonly layer: Layer.Layer<EquationEvaluator, never, never>;
}
export type EquationError = EquationParseError | EquationEvaluationError;
//# sourceMappingURL=Equations.d.ts.map