import { Schema as S } from "effect";
import { UnitMap } from "../Quantity.js";
export type NodeId = string;
export interface Span {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
}
export type UnaryOp = "Neg" | "Pos" | "Not";
export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "AND" | "OR" | "XOR";
export type DelayKind = "DELAY1" | "DELAY3" | "SMOOTH" | "SMOOTH3";
export type TimeKind = "TIME" | "TIME_STEP" | "INITIAL_TIME" | "FINAL_TIME";
export interface QuantityLiteralNode {
    readonly _tag: "QuantityLiteral";
    readonly id: NodeId;
    readonly value: number;
    readonly unit?: UnitMap;
    readonly span: Span;
}
export interface BooleanLiteralNode {
    readonly _tag: "BooleanLiteral";
    readonly id: NodeId;
    readonly value: boolean;
    readonly span: Span;
}
export interface ReferenceNode {
    readonly _tag: "Ref";
    readonly id: NodeId;
    readonly name: string;
    readonly span: Span;
}
export interface UnaryNode {
    readonly _tag: "Unary";
    readonly id: NodeId;
    readonly op: UnaryOp;
    readonly expr: Expr;
    readonly span: Span;
}
export interface BinaryNode {
    readonly _tag: "Binary";
    readonly id: NodeId;
    readonly op: BinaryOp;
    readonly left: Expr;
    readonly right: Expr;
    readonly span: Span;
}
export interface IfBranch {
    readonly cond: Expr;
    readonly then: Expr;
}
export interface IfChainNode {
    readonly _tag: "IfChain";
    readonly id: NodeId;
    readonly branches: ReadonlyArray<IfBranch>;
    readonly elseBranch?: Expr;
    readonly span: Span;
}
export interface CallNode {
    readonly _tag: "Call";
    readonly id: NodeId;
    readonly name: string;
    readonly args: ReadonlyArray<Expr>;
    readonly span: Span;
}
export interface LookupPoint {
    readonly x: number;
    readonly y: number;
}
export interface Lookup1DNode {
    readonly _tag: "Lookup1D";
    readonly id: NodeId;
    readonly x: Expr;
    readonly points: ReadonlyArray<LookupPoint>;
    readonly xUnit?: UnitMap;
    readonly yUnit?: UnitMap;
    readonly span: Span;
}
export interface DelayNode {
    readonly _tag: "Delay";
    readonly id: NodeId;
    readonly kind: DelayKind;
    readonly input: Expr;
    readonly tau: Expr;
    readonly init?: Expr;
    readonly span: Span;
}
export interface TimeNode {
    readonly _tag: "Time";
    readonly id: NodeId;
    readonly kind: TimeKind;
    readonly span: Span;
}
export interface FunctionDefNode {
    readonly _tag: "FunctionDef";
    readonly id: NodeId;
    readonly name: string;
    readonly params: ReadonlyArray<string>;
    readonly body: Expr;
    readonly span: Span;
}
export type Expr = QuantityLiteralNode | BooleanLiteralNode | ReferenceNode | UnaryNode | BinaryNode | IfChainNode | CallNode | Lookup1DNode | DelayNode | TimeNode;
export interface EquationNode {
    readonly _tag: "Equation";
    readonly id: NodeId;
    readonly defs: ReadonlyArray<FunctionDefNode>;
    readonly expr: Expr;
    readonly span: Span;
}
export declare const SpanSchema: S.Schema<Span>;
export declare const QuantityLiteralSchema: S.Schema<QuantityLiteralNode>;
export declare const BooleanLiteralSchema: S.Schema<BooleanLiteralNode>;
export declare const ReferenceSchema: S.Schema<ReferenceNode>;
export declare const LookupPointSchema: S.Schema<LookupPoint>;
export declare const TimeSchema: S.Schema<TimeNode>;
export declare const Lookup1DSchema: S.Schema<Lookup1DNode>;
export declare const DelaySchema: S.Schema<DelayNode>;
export declare const CallSchema: S.Schema<CallNode>;
export declare const IfChainSchema: S.Schema<IfChainNode>;
declare let ExprSchema: S.Schema<Expr>;
export declare const UnarySchema: S.Schema<UnaryNode>;
export declare const BinarySchema: S.Schema<BinaryNode>;
export declare const FunctionDefSchema: S.Schema<FunctionDefNode>;
export declare const EquationSchema: S.Schema<EquationNode>;
export { ExprSchema };
//# sourceMappingURL=Ast.d.ts.map