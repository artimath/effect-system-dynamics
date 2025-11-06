import { Either, Effect } from "effect";
import { And, Bang, BangEq, BooleanFalse, BooleanTrue, Caret, Comma, DoubleAmpersand, DoublePipe, Delay1, Delay3, Else, ElseIf, End, EquationLexer, EqEq, EqSingle, FinalTime, FunctionKw, Gt, GtEq, Identifier, If, InitialTime, Lt, LtEq, LBrace, LParen, Lookup, Minus, Not, NumberLiteral, Or, Percent, Plus, RBrace, ReferenceLiteral, RParen, Slash, Smooth, Smooth3, Star, Then, TimeKeyword, TimeStep, Unknown, WhiteSpace, Xor, } from "./tokens.js";
import { parseUnitExpression } from "./UnitParser.js";
import { EquationDiagnosticError } from "./Diagnostic.js";
const BinaryOperators = new Map([
    [Or, { precedence: 1, op: "OR" }],
    [DoublePipe, { precedence: 1, op: "OR" }],
    [Xor, { precedence: 2, op: "XOR" }],
    [And, { precedence: 3, op: "AND" }],
    [DoubleAmpersand, { precedence: 3, op: "AND" }],
    [EqEq, { precedence: 4, op: "==" }],
    [EqSingle, { precedence: 4, op: "==" }],
    [BangEq, { precedence: 4, op: "!=" }],
    [Lt, { precedence: 5, op: "<" }],
    [LtEq, { precedence: 5, op: "<=" }],
    [Gt, { precedence: 5, op: ">" }],
    [GtEq, { precedence: 5, op: ">=" }],
    [Plus, { precedence: 6, op: "+" }],
    [Minus, { precedence: 6, op: "-" }],
    [Star, { precedence: 7, op: "*" }],
    [Slash, { precedence: 7, op: "/" }],
    [Percent, { precedence: 7, op: "%" }],
    [Caret, { precedence: 8, op: "^", rightAssociative: true }],
]);
const DelayKinds = new Map([
    [Delay1, "DELAY1"],
    [Delay3, "DELAY3"],
    [Smooth, "SMOOTH"],
    [Smooth3, "SMOOTH3"],
]);
const TimeKinds = new Map([
    [TimeKeyword, "TIME"],
    [TimeStep, "TIME_STEP"],
    [InitialTime, "INITIAL_TIME"],
    [FinalTime, "FINAL_TIME"],
]);
const createDiagnostic = (source, token, code, message, hints) => {
    const span = token ? spanFromToken(token) : undefined;
    const base = {
        phase: "parse",
        code,
        message,
        hints: hints ?? [],
    };
    return span
        ? {
            ...base,
            span,
            snippet: snippet(source, span),
        }
        : base;
};
const spanFromToken = (token) => ({
    start: token.startOffset ?? 0,
    end: (token.endOffset ?? token.startOffset ?? 0) + 1,
    line: token.startLine ?? 1,
    column: token.startColumn ?? 1,
});
const snippet = (source, span) => {
    const lines = source.split(/\r?\n/);
    const line = lines[(span.line ?? 1) - 1] ?? "";
    const caretPosition = Math.max(0, (span.column ?? 1) - 1);
    const caretLine = `${" ".repeat(caretPosition)}^`;
    return `${line}\n${caretLine}`;
};
const combineSpans = (start, end) => ({
    start: start.start,
    end: end.end,
    line: start.line,
    column: start.column,
});
class TokenStream {
    #tokens;
    #source;
    #index = 0;
    constructor(tokens, source) {
        this.#tokens = tokens;
        this.#source = source;
    }
    peek(offset = 0) {
        return this.#tokens[this.#index + offset];
    }
    previous(offset = 1) {
        return this.#tokens[this.#index - offset];
    }
    consume() {
        const token = this.peek();
        if (!token) {
            throw new EquationDiagnosticError({
                diagnostic: {
                    phase: "parse",
                    code: "UnexpectedToken",
                    message: "Unexpected end of input",
                },
            });
        }
        this.#index += 1;
        return token;
    }
    match(tokenType) {
        const token = this.peek();
        if (!token) {
            return false;
        }
        if (token.tokenType === tokenType) {
            this.#index += 1;
            return true;
        }
        return false;
    }
    expect(tokenType, message, code = "UnexpectedToken") {
        const token = this.peek();
        if (!token || token.tokenType !== tokenType) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, token, code, message),
            });
        }
        this.#index += 1;
        return token;
    }
    get source() {
        return this.#source;
    }
    get done() {
        return this.#index >= this.#tokens.length;
    }
    get index() {
        return this.#index;
    }
}
const makeId = (span) => `n:${span.start}:${span.end}`;
const lex = (source) => {
    const result = EquationLexer.tokenize(source);
    if (result.errors.length > 0) {
        return result;
    }
    const tokens = result.tokens.filter((token) => token.tokenType !== WhiteSpace && token.tokenType !== Unknown);
    return { tokens, errors: result.errors };
};
const ensureNoUnknownTokens = (source, tokens) => {
    for (const token of tokens) {
        if (token.tokenType === Unknown) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(source, token, "UnknownKeyword", `Unexpected token "${token.image}"`),
            });
        }
    }
};
const referenceName = (token, source) => {
    const start = (token.startOffset ?? 0) + 1;
    let end = token.endOffset ?? token.startOffset ?? start;
    if (!token.endOffset) {
        const closing = source.indexOf("]", start);
        end = closing === -1 ? source.length : closing;
    }
    else {
        end = Math.max(start, end);
        if (source[end] !== "]") {
            const closing = source.indexOf("]", end);
            end = closing === -1 ? source.length : closing;
        }
    }
    return source.slice(start, end).trim();
};
const lookupPointsFromTokens = (stream, startToken) => {
    const points = [];
    while (true) {
        stream.expect(LParen, "Expected '(' starting lookup point tuple");
        const xToken = stream.expect(NumberLiteral, "Expected numeric x value in lookup point");
        stream.expect(Comma, "Expected comma separating lookup tuple");
        const yToken = stream.expect(NumberLiteral, "Expected numeric y value in lookup point");
        stream.expect(RParen, "Expected ')' closing lookup point tuple");
        points.push({ x: Number(xToken.image), y: Number(yToken.image) });
        const next = stream.peek();
        if (!next || next.tokenType !== LParen) {
            break;
        }
    }
    return points;
};
const parseNumber = (token, source) => {
    const value = Number(token.image);
    if (!Number.isFinite(value)) {
        throw new EquationDiagnosticError({
            diagnostic: createDiagnostic(source, token, "UnexpectedToken", `Invalid number literal: ${token.image}`),
        });
    }
    return value;
};
const parseDelayKind = (token, source) => {
    const kind = DelayKinds.get(token.tokenType);
    if (!kind) {
        throw new EquationDiagnosticError({
            diagnostic: createDiagnostic(source, token, "UnexpectedToken", `Unsupported delay primitive: ${token.image}`),
        });
    }
    return kind;
};
const parseTimeKind = (token, source) => {
    const kind = TimeKinds.get(token.tokenType);
    if (!kind) {
        throw new EquationDiagnosticError({
            diagnostic: createDiagnostic(source, token, "UnexpectedToken", `Unsupported time primitive: ${token.image}`),
        });
    }
    return kind;
};
class EquationPrattParser {
    #stream;
    #source;
    constructor(tokens, source) {
        this.#stream = new TokenStream(tokens, source);
        this.#source = source;
    }
    parseEquation() {
        const defs = [];
        while (this.#stream.peek()?.tokenType === FunctionKw) {
            // The callee consumes the FUNCTION token.
            defs.push(this.parseFunctionDefinition());
        }
        const expr = this.parseExpression(0);
        if (!this.#stream.done) {
            const token = this.#stream.peek();
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, token, "TrailingInput", `Unexpected token ${token?.image ?? "<eof>"} after expression`),
            });
        }
        const firstSpan = defs.length > 0 ? defs[0].span : expr.span;
        const lastSpan = expr.span;
        const overallSpan = combineSpans(firstSpan, lastSpan);
        return {
            _tag: "Equation",
            id: makeId(overallSpan),
            defs,
            expr,
            span: overallSpan,
        };
    }
    parseFunctionDefinition() {
        const functionToken = this.#stream.expect(FunctionKw, "Expected FUNCTION keyword");
        const nameToken = this.#stream.expect(Identifier, "Expected function name");
        this.#stream.expect(LParen, "Expected '(' after function name");
        const params = [];
        if (!this.#stream.match(RParen)) {
            do {
                const param = this.#stream.expect(Identifier, "Expected parameter name");
                params.push(param.image);
            } while (this.#stream.match(Comma));
            this.#stream.expect(RParen, "Expected ')' closing parameter list");
        }
        const body = this.parseExpression(0);
        this.#stream.expect(End, "Expected END before FUNCTION terminator");
        this.#stream.expect(FunctionKw, "Expected FUNCTION after END");
        const endToken = this.#stream.previous();
        if (!endToken) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, functionToken, "UnclosedBlock", "Unterminated FUNCTION block"),
            });
        }
        const span = combineSpans(spanFromToken(functionToken), spanFromToken(endToken));
        return {
            _tag: "FunctionDef",
            id: makeId(span),
            name: nameToken.image,
            params,
            body,
            span,
        };
    }
    parseExpression(minPrecedence) {
        let left = this.parseUnary();
        // Pratt loop
        while (true) {
            const token = this.#stream.peek();
            if (!token) {
                break;
            }
            const info = BinaryOperators.get(token.tokenType);
            if (!info) {
                break;
            }
            if (info.precedence < minPrecedence) {
                break;
            }
            this.#stream.consume();
            const nextPrecedence = info.rightAssociative ? info.precedence : info.precedence + 1;
            const right = this.parseExpression(nextPrecedence);
            left = this.makeBinaryNode(info.op, left, right, token);
        }
        return left;
    }
    parseUnary() {
        const token = this.#stream.peek();
        if (!token) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, token, "UnexpectedToken", "Unexpected end of input"),
            });
        }
        if (token.tokenType === Plus || token.tokenType === Minus) {
            this.#stream.consume();
            const op = token.tokenType === Plus ? "Pos" : "Neg";
            const expr = this.parseUnary();
            return this.makeUnaryNode(op, expr, token);
        }
        if (token.tokenType === Not || token.tokenType === Bang) {
            this.#stream.consume();
            const expr = this.parseUnary();
            return this.makeUnaryNode("Not", expr, token);
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        const token = this.#stream.peek();
        if (!token) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, token, "UnexpectedToken", "Unexpected end of input"),
            });
        }
        switch (token.tokenType) {
            case NumberLiteral: {
                this.#stream.consume();
                const value = parseNumber(token, this.#source);
                let unit;
                let endTokenForSpan = token;
                if (this.#stream.match(LBrace)) {
                    const unitResult = this.parseUnitLiteral(token);
                    unit = unitResult.unit;
                    endTokenForSpan = unitResult.endToken;
                }
                const span = combineSpans(spanFromToken(token), spanFromToken(endTokenForSpan));
                const base = {
                    _tag: "QuantityLiteral",
                    id: makeId(span),
                    value,
                    span,
                };
                return unit ? { ...base, unit } : base;
            }
            case BooleanTrue:
            case BooleanFalse: {
                this.#stream.consume();
                const span = spanFromToken(token);
                return {
                    _tag: "BooleanLiteral",
                    id: makeId(span),
                    value: token.tokenType === BooleanTrue,
                    span,
                };
            }
            case ReferenceLiteral: {
                this.#stream.consume();
                const name = referenceName(token, this.#source);
                const span = spanFromToken(token);
                return {
                    _tag: "Ref",
                    id: makeId(span),
                    name,
                    span,
                };
            }
            case LBrace: {
                const lbrace = this.#stream.consume();
                return this.parseBracedQuantity(lbrace);
            }
            case Identifier: {
                this.#stream.consume();
                return this.parseIdentifierOrCall(token);
            }
            case LParen: {
                this.#stream.consume();
                const expr = this.parseExpression(0);
                this.#stream.expect(RParen, "Expected ')' to close group");
                return expr;
            }
            case If: {
                return this.parseIfExpression();
            }
            case Lookup: {
                return this.parseLookup();
            }
            case Delay1:
            case Delay3:
            case Smooth:
            case Smooth3: {
                return this.parseDelay();
            }
            case TimeKeyword:
            case TimeStep:
            case InitialTime:
            case FinalTime: {
                this.#stream.consume();
                const span = spanFromToken(token);
                return {
                    _tag: "Time",
                    id: makeId(span),
                    kind: parseTimeKind(token, this.#source),
                    span,
                };
            }
            default: {
                throw new EquationDiagnosticError({
                    diagnostic: createDiagnostic(this.#source, token, "UnexpectedToken", `Unexpected token ${token.image ?? ""}`),
                });
            }
        }
    }
    parseIdentifierOrCall(token) {
        if (this.#stream.match(LParen)) {
            const args = [];
            if (!this.#stream.match(RParen)) {
                do {
                    args.push(this.parseExpression(0));
                } while (this.#stream.match(Comma));
                this.#stream.expect(RParen, "Expected ')' closing function arguments");
            }
            const endToken = this.#stream.previous();
            const span = combineSpans(spanFromToken(token), spanFromToken(endToken ?? token));
            return {
                _tag: "Call",
                id: makeId(span),
                name: token.image,
                args,
                span,
            };
        }
        const ref = {
            _tag: "Ref",
            id: makeId(spanFromToken(token)),
            name: token.image,
            span: spanFromToken(token),
        };
        return ref;
    }
    parseIfExpression() {
        const ifToken = this.#stream.expect(If, "Expected IF keyword");
        const branches = [];
        const condition = this.parseExpression(0);
        this.#stream.expect(Then, "Expected THEN keyword");
        const thenExpr = this.parseExpression(0);
        branches.push({ cond: condition, then: thenExpr });
        while (this.#stream.match(ElseIf)) {
            const elifCondition = this.parseExpression(0);
            this.#stream.expect(Then, "Expected THEN after ELSEIF condition");
            const elifExpr = this.parseExpression(0);
            branches.push({ cond: elifCondition, then: elifExpr });
        }
        let elseBranch;
        if (this.#stream.match(Else)) {
            elseBranch = this.parseExpression(0);
        }
        this.#stream.expect(End, "Expected END to terminate IF expression");
        this.#stream.expect(If, "Expected IF after END");
        const endToken = this.#stream.previous();
        const span = combineSpans(spanFromToken(ifToken), spanFromToken(endToken ?? ifToken));
        const base = {
            _tag: "IfChain",
            id: makeId(span),
            branches,
            span,
        };
        return elseBranch ? { ...base, elseBranch } : base;
    }
    parseLookup() {
        const lookupToken = this.#stream.expect(Lookup, "Expected LOOKUP keyword");
        this.#stream.expect(LParen, "Expected '(' after LOOKUP");
        const x = this.parseExpression(0);
        this.#stream.expect(Comma, "Expected comma after LOOKUP argument");
        const points = lookupPointsFromTokens(this.#stream, lookupToken);
        this.#stream.expect(RParen, "Expected ')' after LOOKUP table");
        const span = combineSpans(spanFromToken(lookupToken), spanFromToken(this.#stream.previous() ?? lookupToken));
        return {
            _tag: "Lookup1D",
            id: makeId(span),
            x,
            points,
            span,
        };
    }
    parseDelay() {
        const kindToken = this.#stream.consume();
        const kind = parseDelayKind(kindToken, this.#source);
        this.#stream.expect(LParen, "Expected '(' after delay function name");
        const input = this.parseExpression(0);
        this.#stream.expect(Comma, "Expected comma after delay input");
        const tau = this.parseExpression(0);
        let init;
        if (this.#stream.match(Comma)) {
            init = this.parseExpression(0);
        }
        this.#stream.expect(RParen, "Expected ')' closing delay call");
        const span = combineSpans(spanFromToken(kindToken), spanFromToken(this.#stream.previous() ?? kindToken));
        const base = {
            _tag: "Delay",
            id: makeId(span),
            kind,
            input,
            tau,
            span,
        };
        return init ? { ...base, init } : base;
    }
    parseUnitLiteral(numberToken) {
        const lbraceToken = this.#stream.previous();
        if (!lbraceToken) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, numberToken, "UnclosedBlock", "Missing '{' for unit literal"),
            });
        }
        let depth = 1;
        let closing;
        while (depth > 0) {
            const token = this.#stream.consume();
            if (!token) {
                throw new EquationDiagnosticError({
                    diagnostic: createDiagnostic(this.#source, numberToken, "UnclosedBlock", "Unclosed unit literal; missing '}'"),
                });
            }
            if (token.tokenType === LBrace) {
                depth += 1;
            }
            else if (token.tokenType === RBrace) {
                depth -= 1;
                if (depth === 0) {
                    closing = token;
                    break;
                }
            }
        }
        if (!closing) {
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, numberToken, "UnclosedBlock", "Unclosed unit literal; missing '}'"),
            });
        }
        const startOffset = (lbraceToken.endOffset ?? lbraceToken.startOffset ?? numberToken.endOffset ?? 0) + 1;
        const inner = this.#source.slice(startOffset, closing.startOffset ?? startOffset);
        try {
            return {
                unit: parseUnitExpression(inner, startOffset),
                endToken: closing,
            };
        }
        catch (error) {
            if (error instanceof EquationDiagnosticError) {
                throw error;
            }
            throw new EquationDiagnosticError({
                diagnostic: createDiagnostic(this.#source, numberToken, "InvalidUnitToken", error instanceof Error ? error.message : String(error)),
            });
        }
    }
    parseBracedQuantity(lbraceToken) {
        const numberToken = this.#stream.expect(NumberLiteral, "Expected numeric literal inside unit block");
        const value = parseNumber(numberToken, this.#source);
        let closing;
        while (true) {
            const token = this.#stream.consume();
            if (!token) {
                throw new EquationDiagnosticError({
                    diagnostic: createDiagnostic(this.#source, numberToken, "UnclosedBlock", "Unclosed unit literal; missing '}'"),
                });
            }
            if (token.tokenType === RBrace) {
                closing = token;
                break;
            }
        }
        const startOffset = (numberToken.endOffset ?? numberToken.startOffset ?? 0) + 1;
        const endOffset = closing.startOffset ?? startOffset;
        const inner = this.#source.slice(startOffset, endOffset).trim();
        const unit = inner.length > 0 ? parseUnitExpression(inner, startOffset) : Object.create(null);
        const span = combineSpans(spanFromToken(lbraceToken), spanFromToken(closing));
        return {
            _tag: "QuantityLiteral",
            id: makeId(span),
            value,
            unit,
            span,
        };
    }
    makeUnaryNode(op, expr, token) {
        const tokenSpan = spanFromToken(token);
        const span = combineSpans(tokenSpan, expr.span);
        return {
            _tag: "Unary",
            id: makeId(span),
            op,
            expr,
            span,
        };
    }
    makeBinaryNode(op, left, right, token) {
        const span = combineSpans(left.span, right.span);
        return {
            _tag: "Binary",
            id: makeId(span),
            op,
            left,
            right,
            span,
        };
    }
}
export const parseEquationAst = (source) => {
    const { tokens, errors } = lex(source);
    if (errors.length > 0) {
        const { line, column, message } = errors[0];
        throw new EquationDiagnosticError({
            diagnostic: {
                phase: "parse",
                code: "UnexpectedToken",
                message,
                span: {
                    start: column ?? 0,
                    end: column ?? 0,
                    line: line ?? 1,
                    column: column ?? 0,
                },
            },
        });
    }
    ensureNoUnknownTokens(source, tokens);
    const parser = new EquationPrattParser(tokens, source);
    return parser.parseEquation();
};
export const parseEquationEffect = (source) => Effect.try({
    try: () => parseEquationAst(source),
    catch: (error) => {
        if (error instanceof EquationDiagnosticError) {
            throw error;
        }
        throw new EquationDiagnosticError({
            diagnostic: {
                phase: "parse",
                code: "UnexpectedToken",
                message: error instanceof Error ? error.message : String(error),
            },
        });
    },
});
export const parseEquationEither = (source) => Either.try({
    try: () => parseEquationAst(source),
    catch: (error) => error,
});
//# sourceMappingURL=Parser.js.map