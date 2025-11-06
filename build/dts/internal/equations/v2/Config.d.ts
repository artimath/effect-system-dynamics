import { Context } from "effect";
/**
 * Configuration toggle that allows callers to opt into the v2 Equation DSL
 * pipeline while retaining the legacy implementation for backward
 * compatibility. Downstream modules should request this tag to decide which
 * parser/evaluator pair to activate.
 */
export interface EquationDslConfig {
    readonly dslVersion: "v1" | "v2";
}
export declare const EquationConfig: Context.Tag<EquationDslConfig, EquationDslConfig>;
//# sourceMappingURL=Config.d.ts.map