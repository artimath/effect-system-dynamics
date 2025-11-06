/**
 * Minimal pretty-printer used for golden round-trip tests. The output is not
 * intended for direct user-facing display, but it is stable and unambiguous so
 * AST snapshots can be regenerated deterministically.
 */
export const printEquation = (equation) => {
    const defs = equation.defs.map(printFunction).join("\n\n");
    const body = printExpr(equation.expr);
    return defs.length > 0 ? `${defs}\n\n${body}` : body;
};
const printFunction = (fn) => {
    const params = fn.params.join(", ");
    const body = printExpr(fn.body);
    return `FUNCTION ${fn.name}(${params})\n  ${body}\nEND FUNCTION`;
};
const printExpr = (expr) => {
    switch (expr._tag) {
        case "QuantityLiteral":
            return printQuantity(expr);
        case "BooleanLiteral":
            return expr.value ? "TRUE" : "FALSE";
        case "Ref":
            return printReference(expr);
        case "Unary":
            return printUnary(expr);
        case "Binary":
            return printBinary(expr);
        case "Call":
            return printCall(expr);
        case "Lookup1D":
            return printLookup(expr);
        case "Delay":
            return printDelay(expr);
        case "Time":
            return printTime(expr);
        case "IfChain":
            return printIfChain(expr);
        default:
            return "<unknown>";
    }
};
const printQuantity = (literal) => {
    const value = literal.value.toString();
    if (!literal.unit || Object.keys(literal.unit).length === 0) {
        return value;
    }
    return `${value} { ${printUnitMap(literal.unit)} }`;
};
const printReference = (ref) => ref.name.includes(" ") ? `[${ref.name}]` : ref.name;
const printUnary = (node) => {
    const op = node.op === "Not" ? "NOT" : node.op === "Neg" ? "-" : "+";
    const expr = printExpr(node.expr);
    return `${op} ${expr}`;
};
const printBinary = (node) => {
    const left = printExpr(node.left);
    const right = printExpr(node.right);
    const op = node.op === "AND" || node.op === "OR" || node.op === "XOR" ? node.op : node.op;
    return `(${left} ${op} ${right})`;
};
const printCall = (call) => {
    const args = call.args.map(printExpr).join(", ");
    return `${call.name}(${args})`;
};
const printLookup = (lookup) => {
    const x = printExpr(lookup.x);
    const table = lookup.points.map((point) => `(${point.x}, ${point.y})`).join(" ");
    return `LOOKUP(${x}, ${table})`;
};
const printDelay = (delay) => {
    const args = [printExpr(delay.input), printExpr(delay.tau)];
    if (delay.init) {
        args.push(printExpr(delay.init));
    }
    return `${delay.kind}(${args.join(", ")})`;
};
const printTime = (time) => {
    switch (time.kind) {
        case "TIME":
            return "TIME";
        case "TIME_STEP":
            return "TIME STEP";
        case "INITIAL_TIME":
            return "INITIAL TIME";
        case "FINAL_TIME":
            return "FINAL TIME";
    }
};
const printIfChain = (node) => {
    const parts = [];
    const first = node.branches[0];
    if (first) {
        parts.push(`IF ${printExpr(first.cond)} THEN ${printExpr(first.then)}`);
    }
    const rest = node.branches.slice(1);
    for (const branch of rest) {
        parts.push(`ELSEIF ${printExpr(branch.cond)} THEN ${printExpr(branch.then)}`);
    }
    if (node.elseBranch) {
        parts.push(`ELSE ${printExpr(node.elseBranch)}`);
    }
    parts.push("END IF");
    return parts.join("\n");
};
const printUnitMap = (unit) => {
    const entries = Object.keys(unit).sort();
    return entries
        .map((name) => {
        const exponent = unit[name] ?? 0;
        if (Math.abs(exponent - 1) < 1e-12) {
            return name;
        }
        return `${name}^${exponent}`;
    })
        .join(" * ");
};
//# sourceMappingURL=Pretty.js.map