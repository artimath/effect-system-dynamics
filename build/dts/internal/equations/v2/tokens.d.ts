import { Lexer } from "chevrotain";
/**
 * Token definitions for the Equation DSL v2 Chevrotain parser. Keywords are
 * declared with case-insensitive patterns and feed into the identifier token as
 * longer alternatives to preserve simplicity while still enabling canonical
 * rendering in the pretty printer.
 */
export declare const WhiteSpace: import("chevrotain").TokenType;
export declare const LineComment: import("chevrotain").TokenType;
export declare const NumberLiteral: import("chevrotain").TokenType;
export declare const BooleanTrue: import("chevrotain").TokenType;
export declare const BooleanFalse: import("chevrotain").TokenType;
export declare const ReferenceLiteral: import("chevrotain").TokenType;
export declare const DoubleAmpersand: import("chevrotain").TokenType;
export declare const DoublePipe: import("chevrotain").TokenType;
export declare const Identifier: import("chevrotain").TokenType;
export declare const TimeStep: import("chevrotain").TokenType;
export declare const InitialTime: import("chevrotain").TokenType;
export declare const FinalTime: import("chevrotain").TokenType;
export declare const If: import("chevrotain").TokenType;
export declare const Then: import("chevrotain").TokenType;
export declare const Else: import("chevrotain").TokenType;
export declare const ElseIf: import("chevrotain").TokenType;
export declare const End: import("chevrotain").TokenType;
export declare const FunctionKw: import("chevrotain").TokenType;
export declare const Lookup: import("chevrotain").TokenType;
export declare const Delay1: import("chevrotain").TokenType;
export declare const Delay3: import("chevrotain").TokenType;
export declare const Smooth: import("chevrotain").TokenType;
export declare const Smooth3: import("chevrotain").TokenType;
export declare const TimeKeyword: import("chevrotain").TokenType;
export declare const And: import("chevrotain").TokenType;
export declare const Or: import("chevrotain").TokenType;
export declare const Xor: import("chevrotain").TokenType;
export declare const Not: import("chevrotain").TokenType;
export declare const Per: import("chevrotain").TokenType;
export declare const Plus: import("chevrotain").TokenType;
export declare const Minus: import("chevrotain").TokenType;
export declare const Star: import("chevrotain").TokenType;
export declare const Slash: import("chevrotain").TokenType;
export declare const Percent: import("chevrotain").TokenType;
export declare const Caret: import("chevrotain").TokenType;
export declare const EqEq: import("chevrotain").TokenType;
export declare const EqSingle: import("chevrotain").TokenType;
export declare const BangEq: import("chevrotain").TokenType;
export declare const LtEq: import("chevrotain").TokenType;
export declare const GtEq: import("chevrotain").TokenType;
export declare const Lt: import("chevrotain").TokenType;
export declare const Gt: import("chevrotain").TokenType;
export declare const Bang: import("chevrotain").TokenType;
export declare const LParen: import("chevrotain").TokenType;
export declare const RParen: import("chevrotain").TokenType;
export declare const LBrace: import("chevrotain").TokenType;
export declare const RBrace: import("chevrotain").TokenType;
export declare const Comma: import("chevrotain").TokenType;
export declare const Unknown: import("chevrotain").TokenType;
export declare const EquationTokens: import("chevrotain").TokenType[];
export declare const EquationLexer: Lexer;
export declare const UnitIdentifier: import("chevrotain").TokenType;
export declare const UnitPer: import("chevrotain").TokenType;
export declare const UnitNumber: import("chevrotain").TokenType;
export declare const UnitTokens: import("chevrotain").TokenType[];
export declare const UnitLexer: Lexer;
//# sourceMappingURL=tokens.d.ts.map