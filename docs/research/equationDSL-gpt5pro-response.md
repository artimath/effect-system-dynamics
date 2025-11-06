Below is a compact, opinionated **research + design proposal** for a next‑gen, Effect‑idiomatic Equation DSL. It uses your current codebase and docs as the ground truth and focuses on delivering a **minimal, production‑grade** parser/AST that plays perfectly with Effect 3.x and unit‑aware evaluation.

---

## 1) Summary (≤5 sentences)

* **Recommendation:** Replace the ANTLR pipeline with a **TypeScript‑native, minimal parser** built on **Chevrotain** + a tiny **Pratt/precedence climber** for expressions, emitting a **tagged‑union AST** whose schemas are defined with `@effect/schema`.
* Keep the grammar **declarative** (no loops/assignments) and **case‑insensitive**, cover your target surface (conditionals, lookup, delay/smooth, time primitives, macros, unit‑tagged literals).
* Introduce a small **Core IR** (ANF‑ish) for evaluation, constant folding, and unit/type checks; compile macros at parse time; implement delay/smooth via an **Effect service** that stores per‑run state.
* Ship incrementally under a `EquationDsl.v2` feature flag; preserve existing evaluator for legacy expressions until parity is green.
* Expect **2–3× smaller code**, **cleaner error messages**, faster builds (no Java/ANTLR), and an AST that’s trivially serializable, validated, and cached.

---

## 2) Architecture Overview

### Goals

* Minimal grammar → minimal maintenance.
* First‑class **Effect** integration: pure parsing; evaluation is an `Effect` with explicit services for time, lookups, and stateful primitives.
* Unit safety baked into AST and evaluator.

### Why Chevrotain (vs. alternatives)

| Option                       | Pros                                                                                                               | Cons                                                                                                   | Fit                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **Chevrotain (recommended)** | Pure TS, tiny runtime, fast LL(k), precise error recovery, custom tokenization (case‑insensitive), build‑time free | Hand‑written actions (but we want that)                                                                | ✅ Best balance of minimalism + control  |
| ANTLR (trim)                 | Mature, great tooling                                                                                              | Java step, large generated JS, harder to keep “minimal”; CST→AST mapping ceremony                      | ⚠️ Acceptable fallback                  |
| nearley/ohm/peggy            | Very easy grammars                                                                                                 | Earley/PEG packrat can be slower; harder to do first‑class error recovery and unit sub‑grammar cleanly | ⚠️ Prototype only                       |
| Lezer                        | Great for editor/incremental parsing                                                                               | Ecosystem fit is CodeMirror‑first                                                                      | ➖ Optional for editor, not core parsing |

**Pipeline**

```
Source (string)
   └─> Lexer (Chevrotain, case-insensitive)
       └─> Parser (recursive-descent + precedence climber)
           └─> AST (tagged union + spans + optional unit metadata)
               └─> [Compile]  AST -> Core IR (normalize IF/ELSEIF, inline macros, desugar ops)
                   └─> Evaluator (Effect; services: Time, Lookup, Delay/Smooth, Random?)
```

**Effect Services (R environment)**

* `TimeService`: `{ time: number, dt: number, t0: number, t1: number, unit: UnitMap }`
* `LookupService`: interpolation policies + table registry
* `DynStateService`: delay/smooth state store keyed by `(nodeId, runId)`
* `ScopeService`: quantities for references `[Name]` (immutable per step)

**Error Model**

* `EquationParseError`: `{ message, line, column, snippet, code: "UnexpectedToken" | "UnclosedBlock" | ... }`
* `EquationEvaluationError`: `{ message, path?: NodeId[], code: "UnitMismatch" | "NonIntegerExponent" | ... }`

---

## 3) Grammar Sketch (concise, declarative subset)

**Notes**

* Case‑insensitive keywords; identifiers may include letters/digits/underscore; references use brackets `[Stock Name]` (spaces allowed inside).
* Expression precedence: **`^`** (right‑assoc) > `* / %` > `+ -` > comparisons > equality > `AND` > `XOR` > `OR`.
* Units sub‑grammar only appears after a numeric literal inside `{ ... }`.

```
lines            ::= ws? expression ws? EOF
expression       ::= logicalExpression

logicalExpression    ::= equalityExpression ( OR equalityExpression )*
equalityExpression   ::= relationalExpression ( ( '=' | '==' | '!=' | '<>' ) relationalExpression )*
relationalExpression ::= additiveExpression ( ( '<' | '<=' | '>' | '>=' ) additiveExpression )*
additiveExpression   ::= multiplicativeExpression ( ( '+' | '-' ) multiplicativeExpression )*
multiplicativeExpression ::= powerExpression ( ( '*' | '/' | '%' ) powerExpression )*
powerExpression      ::= unaryExpression ( '^' unaryExpression )*
unaryExpression      ::= ( '+' | '-' | 'NOT' | '!' ) unaryExpression
                       | primary

primary         ::= literal
                  | reference
                  | functionCall
                  | conditional
                  | delayCall
                  | lookupCall
                  | timePrimitive
                  | '(' expression ')'

literal         ::= number [ unitLiteral ] | boolean
number          ::= INTEGER | FLOAT
boolean         ::= 'true' | 'false'
unitLiteral     ::= '{' unitProduct '}'

unitProduct     ::= unitTerm ( ( '*' | '/' | 'PER' ) unitTerm )*
unitTerm        ::= unitAtom [ '^' [ '-' ] INTEGER_OR_FLOAT ] [ 'squared' | 'cubed' ]
unitAtom        ::= IDENT (IDENT)* | '(' unitProduct ')'

reference       ::= '[' (~('['|']'))+ ']'
functionCall    ::= IDENT '(' [ expression ( ',' expression )* ] ')'
conditional     ::= 'IF' expression 'THEN' expression ( 'ELSEIF' expression 'THEN' expression )* [ 'ELSE' expression ] 'END' 'IF'
lookupCall      ::= 'LOOKUP' '(' expression ',' lookupTable ')'
lookupTable     ::= '(' number ',' number ')' ( '(' number ',' number ')' )+
delayCall       ::= ('DELAY1'|'DELAY3'|'SMOOTH'|'SMOOTH3') '(' expression ',' expression [ ',' expression ] ')'
timePrimitive   ::= 'TIME' | 'TIME STEP' | 'INITIAL TIME' | 'FINAL TIME'

ws              ::= (space | comment)*
```

**Reserved keywords (case‑insensitive)**: `IF THEN ELSE ELSEIF END LOOKUP DELAY1 DELAY3 SMOOTH SMOOTH3 TIME TIME STEP INITIAL TIME FINAL TIME AND OR XOR NOT PER TRUE FALSE`

---

## 4) AST Design (TypeScript + `@effect/schema`)

> *Guiding idea*: a small, **tagged union** with a `span` on every node, optional `inferredUnit?: UnitMap` (filled by analyzer), and stable `id` for stateful nodes.

### TypeScript (core)

```ts
// Shared
export type UnitMap = Record<string, number>
export type Span = { readonly start: number; readonly end: number; readonly line: number; readonly column: number }
export type NodeId = string  // deterministic from (sourceHash, span) or an incrementing arena id

export interface QuantityLiteral {
  readonly _tag: "QuantityLiteral"
  readonly id: NodeId
  readonly value: number
  readonly unit?: UnitMap
  readonly span: Span
}

export interface Ref {
  readonly _tag: "Ref"
  readonly id: NodeId
  readonly name: string // content inside [ ... ] trimmed
  readonly span: Span
}

export type UnaryOp = "Neg" | "Pos" | "Not"
export interface Unary {
  readonly _tag: "Unary"
  readonly id: NodeId
  readonly op: UnaryOp
  readonly expr: Expr
  readonly span: Span
}

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%" | "^"
  | "<" | "<=" | ">" | ">=" | "==" | "!="
  | "and" | "or" | "xor"

export interface Binary {
  readonly _tag: "Binary"
  readonly id: NodeId
  readonly op: BinaryOp
  readonly left: Expr
  readonly right: Expr
  readonly span: Span
}

export interface IfChain {
  readonly _tag: "IfChain"
  readonly id: NodeId
  readonly branches: ReadonlyArray<{ readonly cond: Expr; readonly then: Expr }>
  readonly elseBranch?: Expr
  readonly span: Span
}

export interface Call {
  readonly _tag: "Call"
  readonly id: NodeId
  readonly name: string     // user macro or builtin
  readonly args: ReadonlyArray<Expr>
  readonly span: Span
}

export interface Lookup1D {
  readonly _tag: "Lookup1D"
  readonly id: NodeId
  readonly x: Expr
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>
  readonly xUnit?: UnitMap
  readonly yUnit?: UnitMap
  readonly span: Span
}

export type DelayKind = "DELAY1" | "DELAY3" | "SMOOTH" | "SMOOTH3"
export interface DelayNode {
  readonly _tag: "Delay"
  readonly id: NodeId      // drives state key
  readonly kind: DelayKind
  readonly input: Expr
  readonly tau: Expr       // must be time dimension
  readonly init?: Expr     // same units as input
  readonly span: Span
}

export type TimeKind = "TIME" | "TIME_STEP" | "INITIAL_TIME" | "FINAL_TIME"
export interface TimeNode {
  readonly _tag: "Time"
  readonly id: NodeId
  readonly kind: TimeKind
  readonly span: Span
}

export interface FunctionDef {
  readonly _tag: "FunctionDef"
  readonly id: NodeId
  readonly name: string
  readonly params: ReadonlyArray<string>
  readonly body: Expr
  readonly span: Span
}

export type Expr =
  | QuantityLiteral | Ref | Unary | Binary | IfChain
  | Call | Lookup1D | DelayNode | TimeNode

export interface Equation {
  readonly _tag: "Equation"
  readonly id: NodeId
  readonly defs: ReadonlyArray<FunctionDef> // zero or more
  readonly expr: Expr                       // single root expression
  readonly span: Span
}
```

### `@effect/schema` (runtime validation & serialization)

```ts
import * as S from "@effect/schema/Schema"

export const UnitMapS = S.Record({ key: S.String, value: S.Number })
export const SpanS = S.Struct({ start: S.Number, end: S.Number, line: S.Number, column: S.Number })

const nodeBase = (tag: string, extra: Record<string, S.Schema<any>>) =>
  S.Struct({ _tag: S.Literal(tag), id: S.String, span: SpanS, ...extra })

export const QuantityLiteralS = nodeBase("QuantityLiteral", {
  value: S.Number,
  unit: S.optional(UnitMapS)
})

export const RefS = nodeBase("Ref", { name: S.String })

export const UnaryOpS = S.Literal("Neg", "Pos", "Not")
export const BinaryOpS = S.Literal(
  "+","-","*","/","%","^","<","<="," >",">=","==","!=","and","or","xor"
)

export const ExprS: S.Schema<Expr> = S.lazy(() => S.Union(
  QuantityLiteralS,
  RefS,
  nodeBase("Unary", { op: UnaryOpS, expr: ExprS }),
  nodeBase("Binary", { op: BinaryOpS, left: ExprS, right: ExprS }),
  nodeBase("IfChain", {
    branches: S.Array(S.Struct({ cond: ExprS, then: ExprS })),
    elseBranch: S.optional(ExprS)
  }),
  nodeBase("Call", { name: S.String, args: S.Array(ExprS) }),
  nodeBase("Lookup1D", {
    x: ExprS,
    points: S.Array(S.Struct({ x: S.Number, y: S.Number })),
    xUnit: S.optional(UnitMapS),
    yUnit: S.optional(UnitMapS),
  }),
  nodeBase("Delay", {
    kind: S.Literal("DELAY1","DELAY3","SMOOTH","SMOOTH3"),
    input: ExprS, tau: ExprS, init: S.optional(ExprS)
  }),
  nodeBase("Time", { kind: S.Literal("TIME","TIME_STEP","INITIAL_TIME","FINAL_TIME") })
))

export const FunctionDefS = nodeBase("FunctionDef", {
  name: S.String,
  params: S.Array(S.String),
  body: ExprS
})

export const EquationS = nodeBase("Equation", {
  defs: S.Array(FunctionDefS),
  expr: ExprS
})
```

---

## 5) Parsing Strategy (CST‑free, AST‑first)

### 5.1 Tokenization

* Chevrotain `createToken({ name, pattern, longer_alt, categories })`, all keyword patterns with `/.../i` for **case‑insensitivity**.
* Special handling:

  * `TIME STEP` as a **two‑token lookahead** collapsed in parser (or a single multi‑word token via control logic).
  * References `[ ... ]`: one token `PRIMITIVE_REF` capturing inner text; allow nested `[[ ... ]]` if needed (keep your current semantics).
  * After a **number**, if next non‑WS char is `{`, route to **unit sub‑parser**.

### 5.2 Expression parsing

* Implement a **precedence climber** (Pratt) over the token stream (Chevrotain’s `consume` + manual functions). This yields:

  * Minimal rule code (~150–250 LOC),
  * Right‑associative `^`,
  * Straightforward mapping to AST nodes (build as you parse).

### 5.3 Units sub‑parser

* Triggered **only** for `number { ... }`.
* Tiny grammar (same as `unitProduct` above) using Pratt with operators `* / PER ^` + suffixes `squared`/`cubed`.
* Returns a `UnitMap`.
* Reject non‑finite exponents and dimensionally invalid constructs early.

### 5.4 Blocks

* `IF ... THEN ... [ELSEIF ... THEN ...]* [ELSE ...] END IF` → directly produce one `IfChain` node with `branches` array; **no CST**.
* `FUNCTION name(params) ... END FUNCTION`: collect defs at the top (or allow in any order, then hoist); body is a single `Expr` (or a minimal expression block: first expression wins).

### 5.5 Error reporting

* On unexpected token: include `line/col`, the next ~16 chars, and the **expected token set** (Chevrotain exposes this).
* On unclosed blocks: synthesize `END IF`/`)` diagnostics by tracking a parser stack.

### 5.6 Parse API (Effect or Either)

```ts
// Pure parse with Effect
export const parseEquation: (src: string) =>
  Effect.Effect<never, EquationParseError, Equation>

// Or pure function with Either
export const parseEquationEither: (src: string) =>
  Either.Either<EquationParseError, Equation>
```

---

## 6) Integration Notes (Effect‑native)

### 6.1 Services & Layers

```ts
// R - environment
export interface TimeService { readonly time: number; readonly dt: number; readonly t0: number; readonly t1: number; readonly unit: UnitMap }
export const TimeService = Context.Tag<TimeService>("TimeService")

export interface LookupService {
  readonly interpolate1D: (table: readonly {x:number;y:number}[], x: number) => number
}
export const LookupService = Context.Tag<LookupService>("LookupService")

export interface DynStateService {
  // state scoped by (nodeId, runId)
  readonly get: (id: NodeId) => Option.Option<number | readonly number[]>
  readonly set: (id: NodeId, value: number | readonly number[]) => void
}
export const DynStateService = Context.Tag<DynStateService>("DynStateService")

export interface ScopeService {
  readonly get: (name: string) => Quantity | undefined
}
export const ScopeService = Context.Tag<ScopeService>("ScopeService")
```

**Layer wiring**

* `EquationLive = Layer.mergeAll(TimeLive, LookupLinearLive, DynStateInMemory, ScopeFromModel)`
* Feature flag:

  ```ts
  export const EquationConfig = Context.Tag<{ dslVersion: "v1" | "v2" }>("EquationConfig")
  // Gate in evaluator/entrypoint
  ```

### 6.2 Core IR & evaluation

* Compile AST → **Core IR** (normalize ELSEIF to nested `If`, desugar `a^b^c` → `a^(b^c)`).
* **Constant folding**: fold any subtree of only literals; compute resulting units with your `Quantity` helpers.
* **Unit rules** (enforced at eval; some at compile when possible):

  * `+/-` require equal units; `*`/`/` compose; `%` only dimensionless.
  * Comparisons require equal units; booleans are **unitless 0/1**.
  * Delay/Smooth require: `tau` has time units; `input/init` share units.
  * Lookup table: monotonic `x`, optional `xUnit/yUnit` annotations.

**Evaluation signatures**

```ts
export const evaluate: (eq: Equation, scope: Readonly<Record<string, Quantity>>) =>
  Effect.Effect<TimeService | LookupService | DynStateService, EquationEvaluationError, Quantity>

// Fast path: cache compiled IR
type CacheKey = string // hash(src + version + macro signatures)
const irCache = new LRU<CacheKey, CompiledIR>(N)
```

### 6.3 Delay/Smooth semantics (discrete time; standard SD)

Given `dt = TIME STEP`, `τ = tau`, input `x_t`, state `y_t`:

* **DELAY1/SMOOTH**: `y_t = y_{t-1} + (dt/τ) * (x_t - y_{t-1})` (if `τ <= 0` ⇒ `y_t = x_t`).
* **DELAY3/SMOOTH3**: cascade 3 first‑order lags (`y1,y2,y3`), same `τ/3` per stage.
* `init` provides `y_0` (and staged initial values for order‑3 = use `init` for each stage or derive by replication).
* State keys: `(node.id)`; `DynStateService` isolates runs.

### 6.4 Lookup semantics

* Require **strictly increasing** `x` axis; reject otherwise with location.
* Linear interpolation; clamp at ends unless `EXTRAPOLATE` policy (optional flag later).
* Units: if `x`/`y` units are annotated in table literal, check them against call‑site.

### 6.5 Compatibility & migration

* Keep existing `evaluateEquation(expression, scope)` as legacy (v1).
* New entry point:

  ```ts
  export const evaluateV2 = (src: string, scope: Scope) =>
    Effect.gen(function*(_) {
      const eq = yield* _(parseEquation(src))    // Effect
      const q  = yield* _(evaluateFromAst(eq, scope))
      return q
    })
  ```
* **Dual path** behind `EquationConfig.dslVersion`; provide a feature flag in your public API.

---

## 7) Testing Plan

**A. Golden parser tests**

* Round‑trip: source → AST (Schema decode) → pretty‑printer → reparse → same AST (modulo spans).
* Cover all node shapes, operator precedence/associativity, whitespace/case insensitivity, error cases.

**B. Property tests**

* With `fast-check`, generate random expressions respecting grammar; ensure parser never crashes and **evaluation equals baseline** for numeric cases (dimensionless subset first).
* Fuzz unit expressions: random `unit` maps; assert `multiply/divide/pow` algebra invariants.

**C. Fixture parity**

* Import your odex/simulation fixtures and the current evaluator subset.
* For arithmetic/logic cases (no IF/LOOKUP/DELAY yet), assert numeric equivalence exactly (or within `1e-12`).
* As 30C lands, add fixtures for IF, LOOKUP1D, DELAY/SMOOTH.

**D. Error snapshots**

* For each diagnostic class (dangling operator, unclosed IF, non‑monotonic lookup, unit mismatch), snapshot `message + caret snippet + code`.

**E. Performance guardrails**

* Microbench parse & evaluate large formula sets; set budget (e.g., parse ≥ 50k expr/s; eval ≥ 5M ops/s dimensionless).

---

## 8) Potential Pitfalls & Mitigations

1. **Ambiguity around `%` vs units** — Ensure `%` only appears as arithmetic modulo in expressions; `%` not allowed inside `{ ... }` unit blocks.
2. **`TIME STEP` tokenization** — Treat as a combined keyword to avoid parsing as `TIME` then `IDENT`.
3. **Exponent rules for units** — Disallow non‑finite/fractional exponents for dimensional quantities at **value** pow; allow any real exponent within `{ ... }` **unit** exponents but keep them numeric (floats).
4. **`^` associativity** — Right‑associative; ensure Pratt levels reflect that; tests for `2^3^2`.
5. **`ELSEIF` chains** — Normalize to `IfChain` deterministically to avoid nesting ambiguity.
6. **Lookup tables** — Enforce monotonic `x`; explicit location in error; clamp vs extrapolate policy must be explicit.
7. **Delay state identity** — Collisions across runs; include a `runId` or maintain separate layer instance per run.
8. **Booleans & units** — Booleans are unitless 0/1; guard comparisons to require unit compatibility; surface helpful messages with both units printed.
9. **Floating equality** — Keep `1e-12` epsilon; document and centralize constant to avoid inconsistencies.
10. **Macro purity** — Parser accepts only expression bodies; evaluator prevents access to stateful services from macros; otherwise they cease to be “pure”.

---

## 9) Detailed Deliverables

### 9.1 Architecture Overview (why this fits Effect idioms)

* **Pure Parse** → `Effect` failure only for structured parse errors; no hidden state.
* **Context/Layer** for runtime dependencies: `Time`, `Lookup`, `DynState`, `Scope`; everything injected and replaceable in tests.
* **Schema‑first AST** ensures **validation/serialization** for your visual builder and persistence (PR‑29).
* **Core IR** enables compile‑time unit checks where possible + constant folding → faster evaluation.

### 9.2 Grammar (EBNF)

See §3 (ready to transcribe to Chevrotain rules). Keep it minimal (no arrays/selectors/loops/assignments).

### 9.3 AST Design

See §4 (TS + `@effect/schema`). Nodes are **small, immutable, tagged**.

### 9.4 Parse → AST strategy

* **CST‑free**: semantic actions create nodes on the fly; attach `span` from token indices.
* Units parsed by a **sub‑parser** invoked after numeric literal + `{`.
* `ELSEIF` chains collected into `branches` vector.
* `FUNCTION ... END FUNCTION` definitions hoisted into `Equation.defs`; **calls** are standard `Call`.

### 9.5 Integration (Effect layers, caching, evaluation)

* **Cache** parsed AST (by content hash) and compiled IR (by `(hash, version, macro sigs)`).
* **Evaluation** returns `Effect<Time | Lookup | DynState, EquationEvaluationError, Quantity>`.
* Feature gating via `EquationConfig.dslVersion`; legacy path untouched until parity.

### 9.6 Testing Plan

See §7. Add **conformance fixtures** for unit edge cases (`{ kg } + { m }` error text, etc.).

### 9.7 Pitfalls

See §8 with mitigations.

---

## 10) Explicit TODO Checklist → Atomic PR Tasks

**PR‑30B — Parser + AST + units**

* [ ] Add `packages/.../equations/v2/parser/tokens.ts` (Chevrotain tokens; case‑insensitive)
* [ ] Implement `unitsSubparser.ts` (Pratt for `{ ... }` → `UnitMap`)
* [ ] Implement `parser.ts` (precedence climber; actions emit AST + spans)
* [ ] Add `ast.ts` + `ast.schema.ts` (TS types + `@effect/schema`)
* [ ] Implement `parseEquation` (Effect) and `parseEquationEither` (Either)
* [ ] Pretty‑printer (stable) for golden tests
* [ ] Tests: precedence matrix, literals with units, IF/ELSEIF shape (parser only)
* [ ] Wire `EquationDsl.v2` flag (config service)

**PR‑30C — Evaluator + services + new constructs**

* [ ] Define services: `TimeService`, `LookupService`, `DynStateService`, `ScopeService` + Layers
* [ ] Implement Core IR + constant folding + unit inference (best‑effort)
* [ ] Evaluate arithmetic/logic with unit safety (reuse `Quantity.ts`)
* [ ] Implement `IfChain` (unit agreement across branches)
* [ ] Implement LOOKUP1D (linear interpolation, clamp policy)
* [ ] Implement DELAY1/DELAY3 & SMOOTH/SMOOTH3 (discrete formulas, state store)
* [ ] Expose `evaluateFromAst` and `evaluateV2(src, scope)`
* [ ] Fixture parity against legacy evaluator for overlapping subset
* [ ] Performance microbench + LRU caches

**PR‑30D — Docs, schema export, migration**

* [ ] Export AST schemas for the visual builder & persistence
* [ ] Author DSL reference (updated `Equation-DSL.md`) with exact grammar + error codes
* [ ] Migration guide (`v1 -> v2`) and feature flag rollout plan
* [ ] Golden snapshot stability tests (printer/AST serialization)

*(Stretch)*

* [ ] 2‑D Lookup (surface) or defer; document.
* [ ] Random helpers via `Random` service.
* [ ] Editor grammar (Lezer) for richer DX if desired.

---

## 11) Algorithmic Notes (precedence, associativity, units)

* **Precedence climber** levels:

  1. Unary (`+`, `-`, `NOT`/`!`)
  2. Power `^` (right‑assoc)
  3. `* / %`
  4. `+ -`
  5. Relational `< <= > >=`
  6. Equality `== != = <>`
  7. Boolean `AND`
  8. Boolean `XOR`
  9. Boolean `OR`
* **Units after numbers** only: `number '{'` lookahead triggers `unitsSubparser`.
  `PER` is parsed as `/` in units domain; suffix `squared/cubed` expand to `^2/^3`.
  Unit multiplication inside `{}` uses `*` or implicit juxtaposition (`IDENT IDENT`), both map to `*`.

---

## 12) Concrete Semantics (selected)

* **Equality tolerance:** `abs(lhs - rhs) <= 1e-12` (unit‑compatible only).
* **Boolean:** unitless `0/1`; `NOT` toggles; `AND/OR/XOR` short‑circuit at evaluation time.
* **IF/ELSEIF/ELSE:** all branches must resolve to **the same units** (enforced).
* **`TIME`, `TIME STEP`, `INITIAL TIME`, `FINAL TIME`:** provided by `TimeService` with appropriate units.
* **LOOKUP:** Enforce strictly increasing `x`; clamp by default; error codes: `"LookupNonMonotonic"`, `"LookupEmpty"`.
* **Delay/Smooth:** see §6.3; `init` defaults to `input` at `t0` if omitted (document explicitly).

---

## 13) Assumptions & Follow‑ups

**Assumptions**

* You will **not** support loops/assignments/selectors in v2; DSL remains declarative.
* `@effect/schema` is available and at least provides `Struct`, `Union`, `lazy`, `Literal`, `Record`.
* Time integration is **fixed‐step** (consistent with your solver); variable step would require re‑deriving discrete forms.

**Open Questions**

1. **2‑D Lookup** necessity for v0.1? (Recommend defer; capture requirement if needed.)
2. **Extrapolation policy** for lookup: clamp vs linear extrapolation? Default is clamp; expose a global flag or per‑call optional arg?
3. **Macro scoping**: allow only pure expressions (no access to Time or stateful services). OK to enforce at parse?
4. **Pretty‑print style**: do you want canonical capitalization of keywords (e.g., `IF`/`THEN`)?
5. **Error codes taxonomy**: agree a stable set now for UI highlighting (`UnexpectedToken`, `UnclosedIf`, `UnitMismatch`, `NonMonotonicLookup`, …).

---

### Final Notes

* If you **must** keep ANTLR temporarily, you can still adopt this **AST** and build a thin **visitor** that maps the current CST into the new nodes. That lets you fold in the new evaluator + services first, and swap the parser later.
* The proposal gives you a **minimal grammar**, a **schema‑validated AST**, and a clear plan to introduce **stateful SD primitives** the Effect way — explicit services, no implicit mutation, excellent testability.
