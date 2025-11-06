import { Caret, LParen, Minus, UnitPer, RParen, Slash, Star, UnitIdentifier, UnitLexer, UnitNumber, WhiteSpace, } from "./tokens.js";
import { divideUnits, multiplyUnits, powUnits } from "../Quantity.js";
import { EquationDiagnosticError } from "./Diagnostic.js";
class Stream {
    #tokens;
    #baseOffset;
    #source;
    #index = 0;
    constructor(tokens, text, baseOffset) {
        this.#tokens = tokens;
        this.#baseOffset = baseOffset;
        this.#source = text;
    }
    peek(offset = 0) {
        return this.#tokens[this.#index + offset];
    }
    consume() {
        const token = this.peek();
        if (!token) {
            throw this.error(undefined, "Unexpected end of unit expression");
        }
        this.#index += 1;
        return token;
    }
    match(tokenType) {
        const token = this.peek();
        if (token && token.tokenType === tokenType) {
            this.#index += 1;
            return true;
        }
        return false;
    }
    expect(tokenType, message, code = "InvalidUnitToken") {
        const token = this.peek();
        if (!token || token.tokenType !== tokenType) {
            throw this.error(token, message, code);
        }
        this.#index += 1;
        return token;
    }
    done() {
        return this.#index >= this.#tokens.length;
    }
    error(token, message, code = "InvalidUnitToken") {
        return new EquationDiagnosticError({
            diagnostic: createUnitDiagnostic(this.#source, this.#baseOffset, token, code, message),
        });
    }
}
const createUnitDiagnostic = (text, baseOffset, token, code, message) => {
    const span = token
        ? {
            start: baseOffset + (token.startOffset ?? 0),
            end: baseOffset + (token.endOffset ?? token.startOffset ?? 0) + 1,
            line: 1,
            column: (token.startColumn ?? 1),
        }
        : undefined;
    const base = {
        phase: "parse",
        code,
        message,
    };
    return span
        ? {
            ...base,
            span,
            snippet: unitSnippet(text, token),
        }
        : base;
};
const unitSnippet = (text, token) => {
    if (!token) {
        return text;
    }
    const caretPosition = Math.max(0, (token.startColumn ?? 1) - 1);
    return `${text}\n${" ".repeat(caretPosition)}^`;
};
const isSquared = (token) => token.image?.toLowerCase() === "squared";
const isCubed = (token) => token.image?.toLowerCase() === "cubed";
const parseProduct = (stream) => {
    let current = parseTerm(stream);
    while (true) {
        if (stream.match(Star)) {
            current = multiplyUnits(current, parseTerm(stream));
            continue;
        }
        if (stream.match(Slash) || stream.match(UnitPer)) {
            current = divideUnits(current, parseTerm(stream));
            continue;
        }
        break;
    }
    return current;
};
const parseTerm = (stream) => {
    let base = parseAtom(stream);
    if (stream.match(Caret)) {
        const negative = stream.match(Minus);
        const exponentToken = stream.expect(UnitNumber, "Expected exponent after '^'", "InvalidUnitExponent");
        const exponent = Number(exponentToken.image) * (negative ? -1 : 1);
        if (!Number.isFinite(exponent)) {
            throw stream.error(exponentToken, "Invalid unit exponent", "InvalidUnitExponent");
        }
        base = powUnits(base, exponent);
    }
    const maybePow = stream.peek();
    if (maybePow && maybePow.tokenType === UnitIdentifier) {
        if (isSquared(maybePow)) {
            stream.consume();
            base = powUnits(base, 2);
        }
        else if (isCubed(maybePow)) {
            stream.consume();
            base = powUnits(base, 3);
        }
    }
    return base;
};
const parseAtom = (stream) => {
    if (stream.match(LParen)) {
        const inner = parseProduct(stream);
        stream.expect(RParen, "Expected ')' in unit literal");
        return inner;
    }
    const token = stream.expect(UnitIdentifier, "Expected unit identifier");
    const parts = [token.image];
    while (true) {
        const next = stream.peek();
        if (!next || next.tokenType !== UnitIdentifier || isSquared(next) || isCubed(next)) {
            break;
        }
        parts.push(stream.consume().image);
    }
    const name = parts.join(" ").trim();
    const unit = Object.create(null);
    unit[name] = 1;
    return unit;
};
export const parseUnitExpression = (text, baseOffset) => {
    const lexing = UnitLexer.tokenize(text);
    if (lexing.errors.length > 0) {
        const { message } = lexing.errors[0];
        throw new EquationDiagnosticError({
            diagnostic: {
                phase: "parse",
                code: "InvalidUnitToken",
                message,
            },
        });
    }
    const tokens = lexing.tokens.filter((token) => token.tokenType !== WhiteSpace);
    if (tokens.length === 0) {
        return Object.create(null);
    }
    const stream = new Stream(tokens, text, baseOffset);
    const result = parseProduct(stream);
    if (!stream.done()) {
        throw stream.error(stream.peek(), "Unexpected trailing input in unit literal", "InvalidUnitToken");
    }
    return result;
};
//# sourceMappingURL=UnitParser.js.map