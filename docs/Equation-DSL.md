# Equation DSL v2 Specification

> **Status**: Finalised for PR-30D — This document is now the normative
> contract for the shipped parser/evaluator and associated tooling surface.

## 1. Purpose *(Normative)*

Define the syntax, semantics, and error model for the Effect System Dynamics
Equation DSL v2 so the parser, evaluator, UI tooling, and persistence layers can
interoperate without ambiguity.

The spec prioritises:

- Pure, declarative equations with explicit unit tracking.
- Deterministic parsing and error recovery suitable for automated tooling.
- Seamless integration with Effect 3.x services (time, lookups, delayed state).

## 2. Design Principles *(Informative)*

1. **Effect-native** – Parsing is pure; evaluation is an Effect that depends on
   explicit services (no hidden globals).
2. **Unit safety** – Units propagate through the AST and are validated at compile
   time when possible and at runtime otherwise.
3. **Minimal surface** – Only the constructs required for production SD models
   are included; arrays/loops/assignments remain out of scope for v2.
4. **Incremental upgrade** – v1 expressions remain available behind a feature
   flag while v2 is rolled out.

## 3. Grammar *(Normative)*

EBNF fragments use uppercase for keywords and `[]` to denote optional elements.
Whitespace and comments are ignored except where noted. The grammar is
case-insensitive.

```ebnf
lines              ::= ws? definition* expression ws? EOF
definition         ::= "FUNCTION" IDENT "(" [ parameters ] ")" expression "END" "FUNCTION"
parameters         ::= IDENT ("," IDENT)*
expression         ::= logicalExpression

logicalExpression  ::= equalityExpression ( OR equalityExpression )*
equalityExpression ::= relationalExpression ( ( "==" | "=" | "!=" | "<>" ) relationalExpression )*
relationalExpression ::= additiveExpression ( ( "<" | "<=" | ">" | ">=" ) additiveExpression )*
additiveExpression ::= multiplicativeExpression ( ( "+" | "-" ) multiplicativeExpression )*
multiplicativeExpression ::= powerExpression ( ( "*" | "/" | "%" ) powerExpression )*
powerExpression    ::= unaryExpression ( "^" unaryExpression )*
unaryExpression    ::= ( "+" | "-" | "NOT" | "!" ) unaryExpression | primary

primary            ::= literal
                     | reference
                     | functionCall
                     | conditional
                     | delayCall
                     | lookupCall
                     | timePrimitive
                     | "(" expression ")"

literal            ::= number [ unitLiteral ] | boolean
number             ::= INTEGER | FLOAT
boolean            ::= "TRUE" | "FALSE"

unitLiteral        ::= "{" unitProduct "}"
unitProduct        ::= unitTerm ( ( "*" | "/" | "PER" ) unitTerm )*
unitTerm           ::= unitAtom [ "^" [ "-" ] (INTEGER | FLOAT) ] [ "SQUARED" | "CUBED" ]
unitAtom           ::= IDENT ( IDENT )* | "(" unitProduct ")"

reference          ::= "[" (~("[" | "]"))+ "]"
functionCall       ::= IDENT "(" [ expression ( "," expression )* ] ")"
conditional        ::= "IF" expression "THEN" expression
                        ( "ELSEIF" expression "THEN" expression )*
                        [ "ELSE" expression ]
                        "END" "IF"

lookupCall         ::= "LOOKUP" "(" expression "," lookupTable ")"
lookupTable        ::= "(" number "," number ")" ( "(" number "," number ")" )+

delayCall          ::= delayKeyword "(" expression "," expression [ "," expression ] ")"
delayKeyword       ::= "DELAY1" | "DELAY3" | "SMOOTH" | "SMOOTH3"

timePrimitive      ::= "TIME" | "TIME STEP" | "INITIAL TIME" | "FINAL TIME"

ws                 ::= ( WHITESPACE | COMMENT )*
```

**Notes** *(Informative)*:

- `TIME STEP` is tokenised as a single keyword.
- References allow spaces inside brackets but cannot nest (`[[...]]`) in v2.
- `%` is modulo in expressions and disallowed inside `{}` unit literals.
- Unit exponents inside `{}` allow any real number; runtime exponentiation of
  dimensional values is limited to integers (see §6.3).

## 4. Tokens *(Normative)*

- Identifiers: `/[a-zA-Z_][a-zA-Z0-9_ ]*/` (trimmed when used as reference names).
- Numbers: standard decimal with optional leading sign handled by unary rules.
- Comments: `// …` to end of line.
- Keywords are case-insensitive; canonical rendering uses uppercase.

## 5. AST Contract *(Normative)*

Every node carries:

- `_tag`: discriminant.
- `id: NodeId` (stable per source span; used for caching/state keys).
- `span: { start: number; end: number; line: number; column: number }`.

Primary node shapes:

| Tag                | Fields                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `QuantityLiteral`  | `value: number`, `unit?: UnitMap`                                       |
| `Ref`              | `name: string` (trimmed reference)                                      |
| `Unary`            | `op: "Neg" | "Pos" | "Not"`, `expr: Expr`                           |
| `Binary`           | `op: BinaryOp`, `left: Expr`, `right: Expr`                             |
| `IfChain`          | `branches: Array<{ cond: Expr; then: Expr }`, `elseBranch?: Expr`       |
| `Call`             | `name: string`, `args: Expr[]`                                          |
| `Lookup1D`         | `x: Expr`, `points: { x: number; y: number }[]`, `xUnit?`, `yUnit?`     |
| `Delay`            | `kind: "DELAY1" | "DELAY3" | "SMOOTH" | "SMOOTH3"`, `input`, `tau`, `init?` |
| `Time`             | `kind: "TIME" | "TIME_STEP" | "INITIAL_TIME" | "FINAL_TIME"`            |
| `FunctionDef`      | `name: string`, `params: string[]`, `body: Expr`                        |
| `Equation`         | `defs: FunctionDef[]`, `expr: Expr`                                     |

Schema definitions are exposed via the `EquationDsl` namespace exported from
`@org/effect-system-dynamics/Equations` (see §8). Each schema is authored with
`@effect/schema` and MUST stay aligned with the corresponding TypeScript
interfaces to guarantee safe persistence and tooling integrations.

## 6. Semantic Rules *(Normative)*

### 6.1 Evaluation Services

The evaluator depends on the following Effect services:

- `TimeService`: `{ time, dt, t0, t1, unit }`.
- `LookupService`: `{ interpolate1D(points, x): number }` (future `interpolate2D`).
- `DynStateService`: `beginRun`, `endRun`, `get(runId, nodeId)`, `set(runId, nodeId, value)`.
- `ScopeService`: `get(name) -> Quantity | undefined` for resolving references.

### 6.2 Macros

- Defined via `FunctionDef` nodes.
- MUST be pure: no references, delay/time primitives, or stateful functions in body.
- MAY call other macros but recursion is prohibited (cycles rejected during
  compilation).
- Expanded at compile time (inline substitution) to enable constant folding.

### 6.3 Units

- Arithmetic `+`/`-` requires operands with identical units.
- `*`/`/` compose unit maps; `%` requires both operands to be dimensionless.
- Comparisons (`<`, `==`, etc.) demand unit equality.
- Exponentiation `value ^ exponent`: if `value` carries units the `exponent`
  MUST be an integer; violations raise `NonIntegerExponent`.
- Lookup tables optionally annotate `xUnit`/`yUnit`; call-site expressions MUST
  match these units when provided.
- Delay/Smooth operations require `tau` to have pure time units and `input`
  /`init` to share the same unit map.

### 6.4 Control Flow

- `IfChain` branches MUST agree on units; the evaluator inserts deferred runtime
  checks if compile-time inference is inconclusive.
- Boolean context uses unitless `0/1` semantics.

### 6.5 Delay/Smooth

- Implemented as discrete first-order (or triple) lags:
  - `DELAY1/SMOOTH`: `y_t = y_{t-1} + (dt/τ) * (x_t - y_{t-1})`.
  - `DELAY3/SMOOTH3`: cascade with `τ/3` each stage.
- Initial state defaults to `input(t0)` when `init` omitted.
- State keys incorporate `runId` and `nodeId`.

## 7. Diagnostics *(Normative)*

All failures surface as `EquationDiagnostic`. The helper namespace exported at
`EquationDsl.Diagnostic` exposes both the `EquationDiagnostic` interface and
`EquationDiagnosticError` class for library consumers to pattern-match on
failures or render rich messages.

```ts
import { EquationDsl } from "@org/effect-system-dynamics"

try {
  EquationDsl.parseEquationAst("1 / 0 { seconds }")
} catch (error) {
  if (error instanceof EquationDsl.EquationDiagnosticError) {
    console.error(error.diagnostic.code, error.diagnostic.snippet)
  }
}
```

Canonical error codes appear in Appendix A.

## 8. Runnable Examples *(Informative)*

The public API exposes a namespace that keeps the parser, pretty printer, AST
schemas, and evaluator accessible to external tooling. The following snippets
are executed in the automated documentation tests (`docs/Equation-DSL.examples`)
to guarantee they remain valid.

### 8.1 Evaluate a dimensioned lookup

```ts
import { EquationDsl } from "@org/effect-system-dynamics"

const scope = {
  Inflow: EquationDsl.makeQuantity(2, { widgets: 1 }),
  "TIME STEP": EquationDsl.makeQuantity(1, { tick: 1 }),
  DelayTime: EquationDsl.makeQuantity(1, { tick: 1 }),
}

const equation = `
LOOKUP([DelayTime], (0, 0) (1, 5)) +
DELAY1([Inflow], { 1 tick }, { 0 widgets })
`

const ast = EquationDsl.parseEquationAst(equation)
const quantity = EquationDsl.evaluateEquationAst(ast, scope, equation, {
  delayState: new EquationDsl.DelayStateStore(),
})

console.log(quantity.value) // => 5.0
console.log(quantity.units) // => { widgets: 1 }
```

### 8.2 Parse, pretty-print, and persist an AST

```ts
import { EquationDsl } from "@org/effect-system-dynamics"

const eq = `FUNCTION Gain(x)\n  x * [Rate]\nEND FUNCTION\nGain([Stock])`
const ast = EquationDsl.parseEquationAst(eq)

// Persisting to storage safely
const encoded = EquationDsl.EquationSchema.encodeSync(ast)

// Later: decode and pretty-print for UI display
const decoded = EquationDsl.EquationSchema.decodeSync(encoded)
const pretty = EquationDsl.printEquation(decoded)
```

## 9. Migration from DSL v1 *(Informative)*

| DSL v1 construct                            | DSL v2 equivalent / guidance                            |
|---------------------------------------------|----------------------------------------------------------|
| `IF a THEN b ELSE c` with newline tolerance | Same syntax; parser is whitespace-insensitive            |
| `IfThenElse(expr, a, b)`                    | Prefer `IF expr THEN a ELSE b END IF`                     |
| Inline macros with assignments               | Rewrite as `FUNCTION` definitions; assignments removed   |
| Function literals capturing references       | Replace with explicit parameters passed via scenario scope |
| V1 delay helpers (`DELAY FIXED`)             | Use `DELAY1` / `DELAY3` or `SMOOTH` / `SMOOTH3`            |

Upgrade checklist:

- [ ] Wrap legacy equations in `EquationDsl.parseEquationEither` during rollout
      to surface parse diagnostics without throwing.
- [ ] Store AST payloads using `EquationDsl.EquationSchema` before toggling the
      default parser in persisted models.
- [ ] Audit macros for purity (no references, time primitives, or delays).
- [ ] Validate unit strings via `EquationDsl.parseUnitExpression` during import
      jobs.

## Appendix A. Canonical Error Codes *(Normative)*

| Phase    | Codes                                                                                                       |
|----------|--------------------------------------------------------------------------------------------------------------|
| Parse    | `UnexpectedToken`, `UnclosedBlock`, `TrailingInput`, `UnterminatedString`, `InvalidUnitExponent`, `InvalidUnitToken`, `UnknownKeyword` |
| Compile  | `MacroRecursion`, `MacroImpureBody`, `DuplicateMacroName`, `InvalidElseIfChain`, `LookupNonMonotonic`, `LookupEmpty`                 |
| Evaluate | `IdentifierNotFound`, `UnitMismatch`, `NonIntegerExponent`, `DimensionlessRequired`, `UnsupportedOperator`, `UnsupportedFunction`, `DelayInvalidTau`, `StateAccessError`, `ComparisonUnitMismatch`, `EqualityUnitMismatch` |

Snippets MUST include a caret and up to 16 surrounding UTF-8 characters when
reported.

## 8. Feature Flag *(Normative)*

`EquationConfig.dslVersion: "v1" | "v2"` gates usage:

- `v1` retains legacy parser/evaluator.
- `v2` activates the Chevrotain-based parser and graph-aware evaluator.

Callers MUST explicitly supply the desired version until v1 is deprecated.

## 9. Testing Requirements *(Normative)*

- **Golden round-trips**: parse → pretty → parse equality (ignoring spans).
- **Property tests**: randomly generated expressions (dimensionless subset) must
  parse without crashing and evaluate equivalently to baseline.
- **Fixture parity**: imported odex/simulation samples validated within
  `1e-12` tolerance when dimensionless.
- **Error snapshots**: deterministic diagnostics for each code.
- **Performance guardrail**: `pnpm test:e2e equation-dsl` ensures parser handles
  ≥50k expressions/s and evaluator hits ≥5M operations/s on baseline fixtures.

## 10. Extensibility *(Informative)*

- Reserved AST node `Lookup2D` is defined for future 2-D interpolation. The
  service API already exposes a placeholder method.
- Macro relaxation (allowing reference access) considered for v2.1 via explicit
  environment parameters.
- Random helper functions may be added once deterministic seeding strategy is
  finalised.

## 11. Change Log *(Informative)*

- **2025-10-31** — Initial canonical draft derived from GPT-5 research response
  and addendum analysis (PR-30A).
