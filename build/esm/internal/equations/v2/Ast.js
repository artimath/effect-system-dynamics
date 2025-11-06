import { Schema as S } from "effect";
export const SpanSchema = S.Struct({
    start: S.Number,
    end: S.Number,
    line: S.Number,
    column: S.Number,
});
const UnitMapSchema = S.Record({
    key: S.String,
    value: S.Number,
});
const nodeBase = (tag, fields) => S.Struct({
    _tag: S.Literal(tag),
    id: S.String,
    span: SpanSchema,
    ...fields,
});
export const QuantityLiteralSchema = nodeBase("QuantityLiteral", {
    value: S.Number,
    unit: S.optional(UnitMapSchema),
});
export const BooleanLiteralSchema = nodeBase("BooleanLiteral", {
    value: S.Boolean,
});
export const ReferenceSchema = nodeBase("Ref", {
    name: S.String,
});
const IfBranchSchema = S.Struct({
    cond: S.suspend(() => ExprSchema),
    then: S.suspend(() => ExprSchema),
});
export const LookupPointSchema = S.Struct({
    x: S.Number,
    y: S.Number,
});
export const TimeSchema = nodeBase("Time", {
    kind: S.Literal("TIME", "TIME_STEP", "INITIAL_TIME", "FINAL_TIME"),
});
export const Lookup1DSchema = S.suspend(() => nodeBase("Lookup1D", {
    x: S.suspend(() => ExprSchema),
    points: S.Array(LookupPointSchema),
    xUnit: S.optional(UnitMapSchema),
    yUnit: S.optional(UnitMapSchema),
}));
export const DelaySchema = S.suspend(() => nodeBase("Delay", {
    kind: S.Literal("DELAY1", "DELAY3", "SMOOTH", "SMOOTH3"),
    input: S.suspend(() => ExprSchema),
    tau: S.suspend(() => ExprSchema),
    init: S.optional(S.suspend(() => ExprSchema)),
}));
export const CallSchema = S.suspend(() => nodeBase("Call", {
    name: S.String,
    args: S.Array(S.suspend(() => ExprSchema)),
}));
export const IfChainSchema = S.suspend(() => nodeBase("IfChain", {
    branches: S.Array(IfBranchSchema),
    elseBranch: S.optional(S.suspend(() => ExprSchema)),
}));
let ExprSchema;
export const UnarySchema = S.suspend(() => nodeBase("Unary", {
    op: S.Literal("Neg", "Pos", "Not"),
    expr: S.suspend(() => ExprSchema),
}));
export const BinarySchema = S.suspend(() => nodeBase("Binary", {
    op: S.Literal("+", "-", "*", "/", "%", "^", "<", "<=", ">", ">=", "==", "!=", "AND", "OR", "XOR"),
    left: S.suspend(() => ExprSchema),
    right: S.suspend(() => ExprSchema),
}));
ExprSchema = S.suspend(() => S.Union(QuantityLiteralSchema, BooleanLiteralSchema, ReferenceSchema, UnarySchema, BinarySchema, IfChainSchema, CallSchema, Lookup1DSchema, DelaySchema, TimeSchema));
export const FunctionDefSchema = S.suspend(() => nodeBase("FunctionDef", {
    name: S.String,
    params: S.Array(S.String),
    body: S.suspend(() => ExprSchema),
}));
export const EquationSchema = S.suspend(() => nodeBase("Equation", {
    defs: S.Array(FunctionDefSchema),
    expr: S.suspend(() => ExprSchema),
}));
export { ExprSchema };
//# sourceMappingURL=Ast.js.map