import { Schema as S } from "effect"
import { UnitMap } from "../Quantity.js"

export type NodeId = string

export interface Span {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly column: number
}

export type UnaryOp = "Neg" | "Pos" | "Not"
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "AND"
  | "OR"
  | "XOR"
export type DelayKind = "DELAY1" | "DELAY3" | "SMOOTH" | "SMOOTH3"
export type TimeKind = "TIME" | "TIME_STEP" | "INITIAL_TIME" | "FINAL_TIME"

export interface QuantityLiteralNode {
  readonly _tag: "QuantityLiteral"
  readonly id: NodeId
  readonly value: number
  readonly unit?: UnitMap
  readonly span: Span
}

export interface BooleanLiteralNode {
  readonly _tag: "BooleanLiteral"
  readonly id: NodeId
  readonly value: boolean
  readonly span: Span
}

export interface ReferenceNode {
  readonly _tag: "Ref"
  readonly id: NodeId
  readonly name: string
  readonly span: Span
}

export interface UnaryNode {
  readonly _tag: "Unary"
  readonly id: NodeId
  readonly op: UnaryOp
  readonly expr: Expr
  readonly span: Span
}

export interface BinaryNode {
  readonly _tag: "Binary"
  readonly id: NodeId
  readonly op: BinaryOp
  readonly left: Expr
  readonly right: Expr
  readonly span: Span
}

export interface IfBranch {
  readonly cond: Expr
  readonly then: Expr
}

export interface IfChainNode {
  readonly _tag: "IfChain"
  readonly id: NodeId
  readonly branches: ReadonlyArray<IfBranch>
  readonly elseBranch?: Expr
  readonly span: Span
}

export interface CallNode {
  readonly _tag: "Call"
  readonly id: NodeId
  readonly name: string
  readonly args: ReadonlyArray<Expr>
  readonly span: Span
}

export interface LookupPoint {
  readonly x: number
  readonly y: number
}

export interface Lookup1DNode {
  readonly _tag: "Lookup1D"
  readonly id: NodeId
  readonly x: Expr
  readonly points: ReadonlyArray<LookupPoint>
  readonly xUnit?: UnitMap
  readonly yUnit?: UnitMap
  readonly span: Span
}

export interface DelayNode {
  readonly _tag: "Delay"
  readonly id: NodeId
  readonly kind: DelayKind
  readonly input: Expr
  readonly tau: Expr
  readonly init?: Expr
  readonly span: Span
}

export interface TimeNode {
  readonly _tag: "Time"
  readonly id: NodeId
  readonly kind: TimeKind
  readonly span: Span
}

export interface FunctionDefNode {
  readonly _tag: "FunctionDef"
  readonly id: NodeId
  readonly name: string
  readonly params: ReadonlyArray<string>
  readonly body: Expr
  readonly span: Span
}

export type Expr =
  | QuantityLiteralNode
  | BooleanLiteralNode
  | ReferenceNode
  | UnaryNode
  | BinaryNode
  | IfChainNode
  | CallNode
  | Lookup1DNode
  | DelayNode
  | TimeNode

export interface EquationNode {
  readonly _tag: "Equation"
  readonly id: NodeId
  readonly defs: ReadonlyArray<FunctionDefNode>
  readonly expr: Expr
  readonly span: Span
}

export const SpanSchema = S.Struct({
  start: S.Number,
  end: S.Number,
  line: S.Number,
  column: S.Number,
}) as S.Schema<Span>

const UnitMapSchema = S.Record({
  key: S.String,
  value: S.Number,
}) as S.Schema<UnitMap>

const nodeBase = <
  Tag extends string,
  Fields extends S.Struct.Fields
>(
  tag: Tag,
  fields: Fields,
) =>
  S.Struct({
    _tag: S.Literal(tag),
    id: S.String,
    span: SpanSchema,
    ...fields,
  })

export const QuantityLiteralSchema: S.Schema<QuantityLiteralNode> = nodeBase("QuantityLiteral", {
  value: S.Number,
  unit: S.optional(UnitMapSchema),
}) as S.Schema<QuantityLiteralNode>

export const BooleanLiteralSchema: S.Schema<BooleanLiteralNode> = nodeBase("BooleanLiteral", {
  value: S.Boolean,
}) as S.Schema<BooleanLiteralNode>

export const ReferenceSchema: S.Schema<ReferenceNode> = nodeBase("Ref", {
  name: S.String,
}) as S.Schema<ReferenceNode>

const IfBranchSchema: S.Schema<IfBranch> = S.Struct({
  cond: S.suspend(() => ExprSchema),
  then: S.suspend(() => ExprSchema),
}) as S.Schema<IfBranch>

export const LookupPointSchema: S.Schema<LookupPoint> = S.Struct({
  x: S.Number,
  y: S.Number,
}) as S.Schema<LookupPoint>

export const TimeSchema: S.Schema<TimeNode> = nodeBase("Time", {
  kind: S.Literal("TIME", "TIME_STEP", "INITIAL_TIME", "FINAL_TIME"),
}) as S.Schema<TimeNode>

export const Lookup1DSchema: S.Schema<Lookup1DNode> = S.suspend(() =>
  nodeBase("Lookup1D", {
    x: S.suspend(() => ExprSchema),
    points: S.Array(LookupPointSchema),
    xUnit: S.optional(UnitMapSchema),
    yUnit: S.optional(UnitMapSchema),
  }),
) as S.Schema<Lookup1DNode>

export const DelaySchema: S.Schema<DelayNode> = S.suspend(() =>
  nodeBase("Delay", {
    kind: S.Literal("DELAY1", "DELAY3", "SMOOTH", "SMOOTH3"),
    input: S.suspend(() => ExprSchema),
    tau: S.suspend(() => ExprSchema),
    init: S.optional(S.suspend(() => ExprSchema)),
  }),
) as S.Schema<DelayNode>

export const CallSchema: S.Schema<CallNode> = S.suspend(() =>
  nodeBase("Call", {
    name: S.String,
    args: S.Array(S.suspend(() => ExprSchema)),
  }),
) as S.Schema<CallNode>

export const IfChainSchema: S.Schema<IfChainNode> = S.suspend(() =>
  nodeBase("IfChain", {
    branches: S.Array(IfBranchSchema),
    elseBranch: S.optional(S.suspend(() => ExprSchema)),
  }),
) as S.Schema<IfChainNode>

let ExprSchema: S.Schema<Expr>

export const UnarySchema: S.Schema<UnaryNode> = S.suspend(() =>
  nodeBase("Unary", {
    op: S.Literal("Neg", "Pos", "Not"),
    expr: S.suspend(() => ExprSchema),
  }),
) as S.Schema<UnaryNode>

export const BinarySchema: S.Schema<BinaryNode> = S.suspend(() =>
  nodeBase("Binary", {
    op: S.Literal(
      "+",
      "-",
      "*",
      "/",
      "%",
      "^",
      "<",
      "<=",
      ">",
      ">=",
      "==",
      "!=",
      "AND",
      "OR",
      "XOR",
    ),
    left: S.suspend(() => ExprSchema),
    right: S.suspend(() => ExprSchema),
  }),
) as S.Schema<BinaryNode>

ExprSchema = S.suspend(() =>
  S.Union(
    QuantityLiteralSchema,
    BooleanLiteralSchema,
    ReferenceSchema,
    UnarySchema,
    BinarySchema,
    IfChainSchema,
    CallSchema,
    Lookup1DSchema,
    DelaySchema,
    TimeSchema,
  ),
) as S.Schema<Expr>

export const FunctionDefSchema: S.Schema<FunctionDefNode> = S.suspend(() =>
  nodeBase("FunctionDef", {
    name: S.String,
    params: S.Array(S.String),
    body: S.suspend(() => ExprSchema),
  }),
) as S.Schema<FunctionDefNode>

export const EquationSchema: S.Schema<EquationNode> = S.suspend(() =>
  nodeBase("Equation", {
    defs: S.Array(FunctionDefSchema),
    expr: S.suspend(() => ExprSchema),
  }),
) as S.Schema<EquationNode>

export { ExprSchema }
