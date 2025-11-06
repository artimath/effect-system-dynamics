import type { EquationNode } from "./Ast.js";
/**
 * Minimal pretty-printer used for golden round-trip tests. The output is not
 * intended for direct user-facing display, but it is stable and unambiguous so
 * AST snapshots can be regenerated deterministically.
 */
export declare const printEquation: (equation: EquationNode) => string;
//# sourceMappingURL=Pretty.d.ts.map