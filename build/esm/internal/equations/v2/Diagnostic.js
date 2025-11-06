import { Data } from "effect";
export class EquationDiagnosticError extends Data.TaggedError("EquationDiagnosticError") {
    get message() {
        return this.diagnostic.message;
    }
}
//# sourceMappingURL=Diagnostic.js.map