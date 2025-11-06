import { Context, Effect, Layer } from "effect";
import { EquationEvaluationError, EquationParseError } from "./internal/equations/errors.js";
import { evaluateEquation } from "./internal/equations/EquationEngine.js";
import { isUnitless, unitlessQuantity } from "./internal/equations/Quantity.js";
import * as EquationDslModule from "./internal/equations/v2/public.js";
export { EquationDslModule as EquationDsl };
export class EquationEvaluator extends Context.Tag("@org/effect-system-dynamics/EquationEvaluator")() {
    static layer = Layer.succeed(this, {
        evaluate: (expression, scope = {}) => Effect.try({
            try: () => {
                const normalizedScope = normalizeScope(scope);
                const quantity = evaluateEquation(expression, normalizedScope);
                if (!isUnitless(quantity)) {
                    throw new EquationEvaluationError({
                        expression,
                        problem: "Equation result must be dimensionless",
                    });
                }
                return quantity.value;
            },
            catch: (error) => error instanceof EquationParseError || error instanceof EquationEvaluationError
                ? error
                : new EquationEvaluationError({
                    expression,
                    problem: error instanceof Error ? error.message : String(error),
                }),
        }),
    });
}
const normalizeScope = (scope) => {
    const result = Object.create(null);
    for (const key of Object.keys(scope)) {
        const value = scope[key];
        if (value !== undefined) {
            result[key] = unitlessQuantity(value);
        }
    }
    return result;
};
//# sourceMappingURL=Equations.js.map