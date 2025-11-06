import { Data } from "effect";
export class EquationParseError extends Data.TaggedError("EquationParseError") {
    get message() {
        return `Equation parse error at line ${this.line}, column ${this.column}: ${this.problem}`;
    }
}
export class EquationEvaluationError extends Data.TaggedError("EquationEvaluationError") {
    get message() {
        return `Equation evaluation error: ${this.problem}`;
    }
}
//# sourceMappingURL=errors.js.map