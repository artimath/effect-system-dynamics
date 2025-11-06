import { createToken, Lexer } from "chevrotain";
/**
 * Token definitions for the Equation DSL v2 Chevrotain parser. Keywords are
 * declared with case-insensitive patterns and feed into the identifier token as
 * longer alternatives to preserve simplicity while still enabling canonical
 * rendering in the pretty printer.
 */
// Whitespace & comments -----------------------------------------------------
export const WhiteSpace = createToken({
    name: "WhiteSpace",
    pattern: /\s+/,
    group: Lexer.SKIPPED,
});
export const LineComment = createToken({
    name: "LineComment",
    pattern: /\/\/[^\n\r]*/,
    group: Lexer.SKIPPED,
});
// Literal tokens -----------------------------------------------------------
export const NumberLiteral = createToken({
    name: "NumberLiteral",
    pattern: /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/,
});
export const BooleanTrue = createToken({
    name: "BooleanTrue",
    pattern: /true/i,
});
export const BooleanFalse = createToken({
    name: "BooleanFalse",
    pattern: /false/i,
});
export const ReferenceLiteral = createToken({
    name: "ReferenceLiteral",
    // Disallow nested closing brackets; trim handled post-lexing.
    pattern: /\[(?:[^\]\r\n]|\]\])+/,
});
export const DoubleAmpersand = createToken({
    name: "DoubleAmpersand",
    pattern: /&&/,
});
export const DoublePipe = createToken({
    name: "DoublePipe",
    pattern: /\|\|/,
});
export const Identifier = createToken({
    name: "Identifier",
    pattern: /[A-Za-z_][A-Za-z0-9_]*/,
});
// Multi-word keywords ------------------------------------------------------
export const TimeStep = createToken({
    name: "TimeStep",
    pattern: /time\s+step/i,
    longer_alt: Identifier,
});
export const InitialTime = createToken({
    name: "InitialTime",
    pattern: /initial\s+time/i,
    longer_alt: Identifier,
});
export const FinalTime = createToken({
    name: "FinalTime",
    pattern: /final\s+time/i,
    longer_alt: Identifier,
});
// Single-word keywords -----------------------------------------------------
const keyword = (name, pattern) => createToken({ name, pattern, longer_alt: Identifier });
export const If = keyword("If", /if/i);
export const Then = keyword("Then", /then/i);
export const Else = keyword("Else", /else/i);
export const ElseIf = keyword("ElseIf", /elseif/i);
export const End = keyword("End", /end/i);
export const FunctionKw = keyword("Function", /function/i);
export const Lookup = keyword("Lookup", /lookup/i);
export const Delay1 = keyword("Delay1", /delay1/i);
export const Delay3 = keyword("Delay3", /delay3/i);
export const Smooth = keyword("Smooth", /smooth/i);
export const Smooth3 = keyword("Smooth3", /smooth3/i);
export const TimeKeyword = keyword("Time", /time/i);
export const And = keyword("And", /and/i);
export const Or = keyword("Or", /or/i);
export const Xor = keyword("Xor", /xor/i);
export const Not = keyword("Not", /not/i);
export const Per = keyword("Per", /per/i);
// Operators ----------------------------------------------------------------
export const Plus = createToken({ name: "Plus", pattern: /\+/ });
export const Minus = createToken({ name: "Minus", pattern: /-/ });
export const Star = createToken({ name: "Star", pattern: /\*/ });
export const Slash = createToken({ name: "Slash", pattern: /\// });
export const Percent = createToken({ name: "Percent", pattern: /%/ });
export const Caret = createToken({ name: "Caret", pattern: /\^/ });
export const EqEq = createToken({ name: "EqEq", pattern: /==/ });
export const EqSingle = createToken({ name: "EqSingle", pattern: /=/ });
export const BangEq = createToken({ name: "BangEq", pattern: /!=|<>/ });
export const LtEq = createToken({ name: "LtEq", pattern: /<=/ });
export const GtEq = createToken({ name: "GtEq", pattern: />=/ });
export const Lt = createToken({ name: "Lt", pattern: /</ });
export const Gt = createToken({ name: "Gt", pattern: />/ });
export const Bang = createToken({ name: "Bang", pattern: /!/ });
// Delimiters ---------------------------------------------------------------
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
// Identifiers --------------------------------------------------------------
export const Unknown = createToken({
    name: "Unknown",
    pattern: /[^\s]/,
});
export const EquationTokens = [
    WhiteSpace,
    LineComment,
    TimeStep,
    InitialTime,
    FinalTime,
    BooleanTrue,
    BooleanFalse,
    If,
    ElseIf,
    Else,
    Then,
    End,
    FunctionKw,
    Lookup,
    Delay3,
    Delay1,
    Smooth3,
    Smooth,
    TimeKeyword,
    And,
    Or,
    Xor,
    Not,
    Per,
    ReferenceLiteral,
    NumberLiteral,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Caret,
    EqEq,
    BangEq,
    EqSingle,
    LtEq,
    GtEq,
    Lt,
    Gt,
    Bang,
    DoubleAmpersand,
    DoublePipe,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Comma,
    Identifier,
    Unknown,
];
export const EquationLexer = new Lexer(EquationTokens, {
    positionTracking: "full",
});
// Unit parsing tokens ------------------------------------------------------
export const UnitIdentifier = createToken({
    name: "UnitIdentifier",
    pattern: /[A-Za-z_][A-Za-z0-9_]*/,
});
export const UnitPer = createToken({
    name: "UnitPer",
    pattern: /per/i,
});
export const UnitNumber = createToken({
    name: "UnitNumber",
    pattern: /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/,
});
export const UnitTokens = [
    WhiteSpace,
    LineComment,
    UnitPer,
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    LParen,
    RParen,
    UnitNumber,
    UnitIdentifier,
    Unknown,
];
export const UnitLexer = new Lexer(UnitTokens, {
    positionTracking: "full",
});
//# sourceMappingURL=tokens.js.map