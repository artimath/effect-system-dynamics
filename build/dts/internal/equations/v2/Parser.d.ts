import { Either, Effect } from "effect";
import type { EquationNode } from "./Ast.js";
export declare const parseEquationAst: (source: string) => EquationNode;
export declare const parseEquationEffect: (source: string) => Effect.Effect<EquationNode, never, never>;
export declare const parseEquationEither: (source: string) => Either.Either<EquationNode, unknown>;
//# sourceMappingURL=Parser.d.ts.map