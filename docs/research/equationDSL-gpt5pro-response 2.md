Awesome—thanks for the sharp read. Below is a **design addendum** that locks down the open questions and fills the gaps you flagged, so the team can implement the Chevrotain+Pratt parser and the v2 evaluator without surprises.

> Copy/paste ready: this is structured so you can drop sections straight into
> `packages/effect-system-dynamics/docs/research/EquationDSL-gpt5pro-prompt.md` as an **Addendum**.

---

# Addendum: Decisions, Specs & Harnesses for Equation DSL v2

## A. Final Decisions (close the open questions)

### A1) Macro semantics: purity & scoping (v2 strict)

**Goal:** guarantee referential transparency and easy compilation.

* **Allowed inside macros**

  * Arithmetic/logic, conditionals, nested macro calls.
* **Forbidden inside macros (v2)**

  * Stateful/time-sensitive forms: `DELAY1/3`, `SMOOTH/3`, `PULSE`, `TIME`, `TIME STEP`, `INITIAL TIME`, `FINAL TIME`, and any future stateful helper.
  * Access to external references `[...]` (to prevent hidden environment capture).
* **Parameters & calls**

  * Positional only (no defaults in v2).
  * Macros may call other macros; **recursion is disallowed** in v2.
* **Purity enforcement**

  * Build a **macro call-graph** at parse time. Reject cycles → `MacroRecursion`.
  * Validate that a macro body contains only allowed node kinds → `MacroImpureBody`.
* **Evaluation model**

  * Macros compile to **pure lambda IR** and are **inlined** at compile time (simple beta-reduction), enabling constant folding and unit inference.

> v2 keeps macros “closed” (parameters only). If you want reference access later, we can add an **explicit `env` parameter** pattern in v2.1.

---

### A2) Unit exponents policy

* **In expressions (`value ^ exponent`):** keep current rule—**dimensional quantities require integer exponents**; dimensionless may use any real exponent. Violation → `NonIntegerExponent`.
* **In unit literals (`{ m^0.5 / s^1.5 }`):** **allow any real exponent** (float), because units are just exponent vectors. This is already compatible with `Quantity.powUnits`.
* **UI/docs note:** Distinguish clearly: “non-integer exponent on a **value with units** is forbidden; non-integer exponent **inside `{}`** is fine.”

---

### A3) Lookup extensibility

* v2 delivers **1‑D** tables (monotonic x, linear interpolation, clamp by default).

* Add a forward-compatible shape for **2‑D** (no implementation in v2):

  ```ts
  export interface Lookup2D {
    readonly _tag: "Lookup2D"
    readonly id: NodeId
    readonly x: Expr
    readonly y: Expr
    readonly grid: { xs: number[]; ys: number[]; z: number[][] } // z[rowY][colX]
    readonly xUnit?: UnitMap
    readonly yUnit?: UnitMap
    readonly zUnit?: UnitMap
    readonly span: Span
  }
  ```

* Service interface from day one is generic enough:

  ```ts
  export interface LookupService {
    readonly interpolate1D: (table: readonly {x:number;y:number}[], x: number) => number
    // Future
    // readonly interpolate2D: (grid: {xs:number[]; ys:number[]; z:number[][]}, x:number, y:number) => number
  }
  ```

* **Policy flags (global config)**

  * `lookup.extrapolation: "clamp" | "linear"` (default: `clamp`)
  * `lookup.strictMonotonic: boolean` (default: `true`)

---

### A4) Error taxonomy (canonical, UI-aligned)

```ts
export type EquationErrorPhase = "parse" | "compile" | "evaluate"

export type EquationErrorCode =
  // Parse
  | "UnexpectedToken"
  | "UnclosedBlock"
  | "TrailingInput"
  | "UnterminatedString"
  | "InvalidUnitExponent"
  | "InvalidUnitToken"
  | "UnknownKeyword"
  // Compile (AST -> IR, macro checks, unit checks when decidable)
  | "MacroRecursion"
  | "MacroImpureBody"
  | "DuplicateMacroName"
  | "InvalidElseIfChain"
  | "LookupNonMonotonic"
  | "LookupEmpty"
  // Evaluate (runtime)
  | "IdentifierNotFound"
  | "UnitMismatch"
  | "NonIntegerExponent"
  | "DimensionlessRequired"
  | "UnsupportedOperator"
  | "UnsupportedFunction"
  | "DelayInvalidTau"
  | "StateAccessError"
  | "ComparisonUnitMismatch"
  | "EqualityUnitMismatch"
```

**Error payload (all phases)**

```ts
export interface EquationDiagnostic {
  readonly phase: EquationErrorPhase
  readonly code: EquationErrorCode
  readonly message: string
  readonly span?: Span               // where we can point precisely
  readonly snippet?: string          // short context w/ caret
  readonly hints?: readonly string[] // remediation tips
  readonly meta?: Record<string, unknown> // e.g., {leftUnit, rightUnit}
}
```

**Mapping to existing errors**

* Current stringly errors from `Quantity.ts` translate to:

  * thrown `UNIT_MISMATCH` → `UnitMismatch`
  * `NON_INTEGER_EXPONENT` → `NonIntegerExponent`
* Keep your `EquationParseError` / `EquationEvaluationError` classes, but make them thin wrappers over `EquationDiagnostic`.

**Deterministic snippets**

* Reuse/improve your `snapshotSnippet`: include a **caret line** (`"    ^"`) and elide with `…` on both sides when long.

---

### A5) Delay/Smooth lifecycle & keys

* **Keying:** `stateKey = `${runId}:${nodeId}``.
* **Run lifecycle (required)**

  ```ts
  export interface DynStateService {
    beginRun(runId: string): void        // clears state for runId if exists
    endRun(runId: string): void          // optional: cleanup to free memory
    get(runId: string, nodeId: NodeId): Option.Option<number | number[]>
    set(runId: string, nodeId: NodeId, val: number | number[]): void
  }
  ```
* Solver must call `beginRun` at the start of a scenario/simulation and `endRun` after completion.
* **Determinism:** no cross-run leakage; tests must assert state is fresh per run.
* **Default init:** if `init` omitted, set `y0 = input(t0)` on first step.

---

### A6) Minimum viable unit inference (v2)

* **Bottom‑up single‑pass** computes `UnitInfo`:

  ```ts
  type UnitInfo = { unit?: UnitMap; known: boolean }
  ```
* Rules (selected):

  * Literal: `{ known: true, unit: literalUnit || {} }`
  * Ref: `{ known: false }` (unless scope schema provided at compile time)
  * Unary `-`/`+`: propagate
  * `*`/`/`: if both known → combine; else `{ known:false }`
  * `+`/`-`: if both known → require equal, propagate; if one known & one unknown → `{ known:false }` but attach a **deferred check** at runtime at that node id.
  * `%`: both args must be dimensionless (enforce when both known; otherwise defer)
  * Comparisons: enforce equal units when both known; else defer
  * IF: **all branches must unify**; if one unknown → result unknown, add deferred runtime check to ensure equality when evaluating.
  * Lookup: `yUnit` known if table y annotated; else unknown; `x` must equal annotated `xUnit` if provided; otherwise defer.
  * Delay/Smooth: `input` and `init` must unify; `tau` must match time unit.

> v2: fail **only** when contradiction is provable at compile-time. Otherwise attach a **deferred check** evaluated with a precise error at runtime.

---

### A7) Evaluator factory & Graph integration

**One shape, two engines.**

```ts
export interface EvaluationEngine {
  // Parse or use cached AST
  parse(src: string): Effect.Effect<never, EquationDiagnostic, Equation>

  // Evaluate from source (uses internal cache) or from AST
  evaluate(src: string, scope: Readonly<Record<string, Quantity>>): 
    Effect.Effect<TimeService | LookupService | DynStateService, EquationDiagnostic, Quantity>

  evaluateAst(ast: Equation, scope: Readonly<Record<string, Quantity>>): 
    Effect.Effect<TimeService | LookupService | DynStateService, EquationDiagnostic, Quantity>
}

export const EvaluationEngineV1: Layer.Layer<never, never, EvaluationEngine>
export const EvaluationEngineV2: Layer.Layer<TimeService | LookupService | DynStateService, never, EvaluationEngine>

// Shim that picks the engine by config:
export const EvaluationEngineLive: Layer.Layer<
  TimeService | LookupService | DynStateService | EquationConfig,
  never,
  EvaluationEngine
>
```

Graph/Solver depends only on `EvaluationEngine` and `EquationConfig`—no duplication.

---

## B. Parser: token & Pratt skeletons (key tricky bits)

```ts
// tokens.ts
import { createToken, Lexer, ITokenConfig, TokenType } from "chevrotain"

// Helpers
const k = (s: string) => new RegExp(s.replace(/\s+/g, "\\s+"), "iy") // multi-word, case-insensitive
const ci = (s: string) => new RegExp(s, "iy")                        // single word, case-insensitive

// Order matters: longer matches first
export const TIME_STEP   = createToken({ name: "TIME_STEP", pattern: k("TIME STEP") })
export const INITIAL_TIME= createToken({ name: "INITIAL_TIME", pattern: k("INITIAL TIME") })
export const FINAL_TIME  = createToken({ name: "FINAL_TIME", pattern: k("FINAL TIME") })
export const TIME        = createToken({ name: "TIME", pattern: ci("TIME") })

export const IF   = createToken({ name: "IF",   pattern: ci("IF") })
export const THEN = createToken({ name: "THEN", pattern: ci("THEN") })
export const ELSE = createToken({ name: "ELSE", pattern: ci("ELSE") })
export const ELSEIF = createToken({ name: "ELSEIF", pattern: ci("ELSEIF") })
export const END  = createToken({ name: "END",  pattern: ci("END") })

export const LOOKUP = createToken({ name: "LOOKUP", pattern: ci("LOOKUP") })
export const DELAY1 = createToken({ name: "DELAY1", pattern: ci("DELAY1") })
export const DELAY3 = createToken({ name: "DELAY3", pattern: ci("DELAY3") })
export const SMOOTH = createToken({ name: "SMOOTH", pattern: ci("SMOOTH") })
export const SMOOTH3 = createToken({ name: "SMOOTH3", pattern: ci("SMOOTH3") })

export const AND = createToken({ name: "AND", pattern: ci("AND") })
export const OR  = createToken({ name: "OR",  pattern: ci("OR") })
export const XOR = createToken({ name: "XOR", pattern: ci("XOR") })
export const NOT = createToken({ name: "NOT", pattern: ci("NOT") })

export const TRUE  = createToken({ name: "TRUE",  pattern: ci("TRUE") })
export const FALSE = createToken({ name: "FALSE", pattern: ci("FALSE") })

export const PER   = createToken({ name: "PER", pattern: ci("PER") }) // used in unit subparser

export const LPAR  = createToken({ name: "LPAR", pattern: /\(/y })
export const RPAR  = createToken({ name: "RPAR", pattern: /\)/y })
export const LBR   = createToken({ name: "LBR",  pattern: /\[/y })
export const RBR   = createToken({ name: "RBR",  pattern: /]/y })
export const LBRACE= createToken({ name: "LBRACE", pattern: /{/y })
export const RBRACE= createToken({ name: "RBRACE", pattern: /}/y })
export const COMMA = createToken({ name: "COMMA", pattern: /,/y })

export const PLUS = createToken({ name: "PLUS", pattern: /\+/y })
export const MINUS= createToken({ name: "MINUS",pattern: /-/y })
export const MUL  = createToken({ name: "MUL",  pattern: /\*/y })
export const DIV  = createToken({ name: "DIV",  pattern: /\//y })
export const MOD  = createToken({ name: "MOD",  pattern: /%/y })
export const POW  = createToken({ name: "POW",  pattern: /\^/y })
export const EQ   = createToken({ name: "EQ",   pattern: /==|=/y })
export const NEQ  = createToken({ name: "NEQ",  pattern: /!=|<>/y })
export const LT   = createToken({ name: "LT",   pattern: /</y })
export const LTE  = createToken({ name: "LTE",  pattern: /<=/y })
export const GT   = createToken({ name: "GT",   pattern: />/y })
export const GTE  = createToken({ name: "GTE",  pattern: />=/y })

// NUMBER before IDENT so "1e-3" is number
export const NUMBER = createToken({ name: "NUMBER", pattern: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y })

// [Reference] including spaces inside, single token
export const PRIMITIVE = createToken({
  name: "PRIMITIVE",
  // Custom exec: read `[`...`]` including nested `[[...]]`
  pattern: {
    exec: (text: string, startOffset: number) => {
      if (text.charCodeAt(startOffset) !== 91 /* '[' */) return null
      let i = startOffset + 1, depth = 1
      while (i < text.length && depth > 0) {
        const ch = text.charCodeAt(i)
        if (ch === 91) depth++
        else if (ch === 93) depth--
        i++
      }
      return depth === 0 ? [text.slice(startOffset, i)] as unknown as RegExpExecArray : null
    }
  }
})

export const IDENT = createToken({
  name: "IDENT",
  pattern: /[A-Za-z_][A-Za-z0-9_]*/y
})

export const WS = createToken({
  name: "WS",
  pattern: /(?:\s|\/\/[^\n\r]*|\/\*[^]*?\*\/)+/y,
  group: Lexer.SKIPPED
})

export const AllTokens: TokenType[] = [
  WS,
  // multi-word first
  TIME_STEP, INITIAL_TIME, FINAL_TIME,
  // keywords
  TIME, IF, THEN, ELSE, ELSEIF, END, LOOKUP, DELAY1, DELAY3, SMOOTH, SMOOTH3, AND, OR, XOR, NOT,
  TRUE, FALSE, PER,
  // symbols
  LPAR, RPAR, LBR, RBR, LBRACE, RBRACE, COMMA,
  PLUS, MINUS, MUL, DIV, MOD, POW, EQ, NEQ, LTE, LT, GTE, GT,
  NUMBER, PRIMITIVE, IDENT
]

export const EquationLexer = new Lexer(AllTokens, { positionTracking: "full" })
```

**Pratt expression climber (outline)**

```ts
// pratt.ts
import type { IToken, TokenType } from "chevrotain"
import { EquationLexer, /* tokens... */ } from "./tokens"

type Nud = () => Expr
type Led = (left: Expr) => Expr

// binding power table (higher binds tighter)
const BP = {
  or: 10, xor: 20, and: 30,
  eq: 40, rel: 50,
  add: 60, mul: 70, pow: 80,
  prefix: 90,
}

class Parser {
  private idx = 0
  constructor(private readonly tokens: IToken[], private readonly src: string) {}

  private LA(n = 0) { return this.tokens[this.idx + n] }
  private match(t: TokenType) { const k = this.LA(); if (k?.tokenType === t){ this.idx++; return k } throw this.err("UnexpectedToken", k) }
  private accept(t: TokenType) { if (this.LA()?.tokenType === t){ return this.tokens[this.idx++] } return undefined }

  parseExpression(minBp = 0): Expr {
    let left = this.parsePrefix()
    while (true) {
      const op = this.LA()
      const bp = this.infixBp(op)
      if (bp === undefined || bp.lbp < minBp) break
      this.idx++ // consume operator
      const rbp = bp.rbp
      const right = op.tokenType === POW ? this.parseExpression(rbp) : this.parseExpression(rbp) // POW right-assoc
      left = this.makeBinary(op, left, right)
    }
    return left
  }

  // ... parsePrefix(), parsePrimary(), and dedicated routines for IF/LOOKUP/DELAY etc.

  // unit subparser is invoked inside parsePrimary after NUMBER + LBRACE
}
```

This keeps the parser **AST-first** (no CST), attaches `span` from token `startOffset`/`endOffset` and `startLine`/`startColumn`.

---

## C. Persistence JSON shape (stable, versioned)

* **Envelope** (so we can change node shapes without breaking storage):

  ```json
  {
    "schema": "effect-sd-equation/2",
    "version": 2,
    "ast": { "...": "Equation node per schema" },
    "hash": "sha256:...",
    "pretty": "IF A THEN B ELSE C END IF",
    "createdAt": "2025-10-30T12:34:56Z"
  }
  ```

* **Example (trimmed)**:

  ```json
  {
    "schema": "effect-sd-equation/2",
    "version": 2,
    "ast": {
      "_tag": "Equation",
      "id": "eq:0-27",
      "defs": [],
      "expr": {
        "_tag": "IfChain",
        "id": "n2",
        "branches": [
          {
            "cond": { "_tag": "Binary", "id": "n3", "op": "<", "left": { "_tag": "Ref", "id": "n4", "name": "Population", "span": { "start": 3, "end": 14, "line": 1, "column": 4 } }, "right": { "_tag": "QuantityLiteral", "id": "n5", "value": 1000, "span": { "start": 17, "end": 21, "line": 1, "column": 18 } }, "span": { "start": 3, "end": 21, "line": 1, "column": 4 } },
            "then": { "_tag": "Ref", "id": "n6", "name": "GrowthA", "span": { "start": 28, "end": 35, "line": 1, "column": 29 } }
          }
        ],
        "elseBranch": { "_tag": "Ref", "id": "n7", "name": "GrowthB", "span": { "start": 43, "end": 50, "line": 1, "column": 44 } },
        "span": { "start": 0, "end": 54, "line": 1, "column": 1 }
      },
      "span": { "start": 0, "end": 54, "line": 1, "column": 1 }
    },
    "hash": "sha256:deadbeef...",
    "pretty": "IF [Population] < 1000 THEN [GrowthA] ELSE [GrowthB] END IF",
    "createdAt": "2025-10-30T12:34:56Z"
  }
  ```

* **NodeId convention** in v2: `"n<counter>"` during parse for stability within one AST; envelope `hash` covers source for deduping/caching. (If you want semantic ids, switch to `"n:${start}-${end}"`—works well for state keys too.)

---

## D. Dual‑runner parity harness (A/B)

* **Goal:** run v1 and v2 in lockstep on overlapping features and report diffs.

```ts
// test/harness/equation.ab.ts
type Case = {
  name: string
  src: string
  scope: Readonly<Record<string, Quantity>>
  expect?: number // optional golden numeric for strict cases
}

export const runAB = (cases: Case[]) =>
  Effect.forEach(cases, (c) =>
    Effect.gen(function*(_) {
      const v1 = yield* _(Effect.try(() => evaluateEquation(c.src, c.scope))) // existing API
      const v2 = yield* _(EvaluationEngineLive.pipe(Effect.flatMap(engine => engine.evaluate(c.src, c.scope))))
      // numeric compare within 1e-12 and units exact
      assertUnitsEqual(v1.units, v2.units, c.name)
      assert(Math.abs(v1.value - v2.value) <= 1e-12, `${c.name}: values differ`)
      if (c.expect !== undefined) {
        assert(Math.abs(v2.value - c.expect) <= 1e-12, `${c.name}: golden mismatch`)
      }
    })
  )
```

* **Datasets**

  * Real fixtures from odex/simulation (arithmetic/logic only at first).
  * Synthetic generators (fast-check) constrained to the v1 surface.

* Wire a CI job `pnpm test:ab` that must remain green through 30C.

---

## E. Performance benchmarking harness

**Targets**

* Parse throughput: **≥ 50k expr/s** (short expr ~40–120 chars) on CI baseline runner.
* Eval throughput (dimensionless arithmetic): **≥ 5M ops/s** aggregated across cases.
* **Memory:** parser < 1.5× v1 peak on 10k expr batch.

**Design**

* Use `tinybench` (fast, zero deps bloat).
* Separate suites: parser, evaluator (arithmetic only), evaluator (boolean/compare), lookup (linear), delay/smooth (with 1e6 steps synthetic).

**CLI**

```json
// package.json
{
  "scripts": {
    "bench:parser": "tsx ./bench/bench.parser.ts",
    "bench:eval": "tsx ./bench/bench.eval.ts",
    "bench:report": "node ./bench/report.js"
  }
}
```

**Example `bench/bench.parser.ts` (outline)**

```ts
import { Bench } from "tinybench"
import { parseEquationEither } from "../src/v2/parse"
import { cases } from "./cases"

const bench = new Bench({ time: 1000 })
for (const c of cases.small) {
  bench.add(`parse:${c.name}`, () => { const _ = parseEquationEither(c.src) })
}
await bench.run()
console.log(JSON.stringify(bench.tasks.map(t => ({ name:t.name, hz:t.result?.hz })), null, 2))
```

**CI gating**

* Parse json → compare against thresholds; fail PR if < 90% of baseline.
* Keep last successful baselines in repo (`bench/baseline.json`) and allow manual bump via a versioned PR.

---

## F. Pretty‑printer & golden tests

* Emit canonical formatting:

  * Uppercase keywords (`IF`, `THEN`, `ELSE`, …).
  * Space rules: `a + b`, `a^b`, commas followed by space.
  * Units retain original token text (`{ kg / m^2 }`) but canonicalize operators (`*` and `/`) and exponents (`^`).
* Golden pipeline:

  1. `parse(src)` → `ast`
  2. `print(ast)` → `s1`
  3. `parse(s1)` → `ast1`
  4. `assert structurallyEqual(ast, ast1, ignore=["id","span"])`

---

## G. Concrete integration points

### G1) New public API

```ts
// v2 surface (in addition to legacy v1)
export const EquationDslV2 = {
  parse: parseEquation,                    // Effect<never, EquationDiagnostic, Equation>
  evaluate: evaluateV2,                    // Effect<Time|Lookup|DynState, EquationDiagnostic, Quantity>
  pretty: (ast: Equation) => string,
  schema: { EquationS, ExprS }             // export for UI/persistence
}
```

### G2) Feature flag (unchanged intent, explicit wiring)

```ts
export interface EquationConfig { readonly dslVersion: "v1" | "v2" }
export const EquationConfig = Context.Tag<EquationConfig>("EquationConfig")

// Entry
export const evaluateEquationUnified = (
  src: string,
  scope: Readonly<Record<string, Quantity>>
) =>
  Effect.gen(function*(_) {
    const cfg = yield* _(Effect.contextWith(EquationConfig))
    const engine = yield* _(
      cfg.dslVersion === "v1" ? EvaluationEngineV1 : EvaluationEngineV2
    )
    return yield* _(engine.evaluate(src, scope))
  })
```

---

## H. Updated TODOs (add to your checklist)

**Parser & AST**

* [ ] Implement tokens (multi‑word, case‑insensitive) and PRATT climber.
* [ ] Unit sub‑parser allowing real exponents within `{}`; clear errors.
* [ ] Attach spans; NodeId scheme `"n:${start}-${end}"`.
* [ ] Pretty‑printer (canonical keyword casing & spacing).

**Macros**

* [ ] Enforce purity (no refs/time/stateful forms) via node visitor.
* [ ] Build call-graph; reject cycles.
* [ ] Inline macro calls at compile time.

**Evaluator & Services**

* [ ] Implement `DynStateService.beginRun/endRun`.
* [ ] Enforce `tau > 0` → else fall back to passthrough (`y = x`), code `DelayInvalidTau` if NaN/neg.
* [ ] LOOKUP1D with `clamp` default, `LookupNonMonotonic` error with span at offending pair.

**Unit inference**

* [ ] Single-pass inference with deferred checks; add runtime check hooks to IR nodes.
* [ ] Compile-time checks for known-known pairs; raise `UnitMismatch`/`ComparisonUnitMismatch`.

**Errors**

* [ ] Implement `EquationDiagnostic` and map existing throws to codes.
* [ ] Standardize snippets with caret; add `hints` for common mistakes.

**A/B & Perf**

* [ ] Dual-runner harness; wire fixtures; CI job `test:ab`.
* [ ] Bench suites; CI thresholds; baseline management.

**Persistence**

* [ ] Envelope shape with `schema`, `version`, `hash`, `pretty`.
* [ ] Spanner (or store) mapping doc: column types, indices by `hash`, migration notes.

**Graph Integration**

* [ ] `EvaluationEngine` service; V1/V2 layers; `EvaluationEngineLive` selects by flag.
* [ ] Keep scope shape identical; add adapter tests at Graph boundary.

---

## I. Snippets the team can start from

**1) Unit mismatch message helper**

```ts
const fmtUnit = (u: UnitMap) => Object.keys(u).sort().map(k => `${k}^${u[k]}`).join(" * ") || "1"

export const unitMismatch = (left: UnitMap, right: UnitMap, msg: string, span?: Span): EquationDiagnostic => ({
  phase: "evaluate",
  code: "UnitMismatch",
  message: `${msg}: ${fmtUnit(left)} vs ${fmtUnit(right)}`,
  span,
  hints: ["Check branch units in IF/ELSE", "Ensure lookup table y-units match usage"]
})
```

**2) Delay1 discrete step**

```ts
const stepDelay1 = (x: number, yPrev: number, dt: number, tau: number) =>
  tau <= 0 ? x : yPrev + (dt / tau) * (x - yPrev)
```

**3) Compile-time macro purity check (outline)**

```ts
const isStateful = (e: Expr): boolean =>
  e._tag === "Delay" || e._tag === "Time" || (e._tag === "Call" && statefulNames.has(e.name))

const hasReference = (e: Expr): boolean =>
  e._tag === "Ref" || (("args" in e) && e.args.some(hasReference)) || // recurse children...
  (("left" in e) && (hasReference(e.left) || hasReference(e.right))) ||
  // ...add all other shapes
  false
```

---

## J. Documentation notes (PR‑30D tie‑ins)

* Add a **“Semantics at a glance”** table with unit rules and boolean semantics.
* Include the **error codes table** and examples in `docs/Equation-DSL.md`.
* Publish the JSON **envelope** and an example for IF/LOOKUP/DELAY.
* Document the **bench harness commands** + how CI gates PRs.

---

### Quick recap

* We’ve locked down **macro purity**, **unit exponent policy**, **lookup extensibility**, **error taxonomy**, **state lifecycle**, **unit inference MVP**, the **evaluator factory**, **persistence JSON**, and the **A/B & perf harnesses**.
* These changes slot directly into PR‑30B/C/D with concrete code shapes and test plans.

If you want, I can turn Sections **B** (tokens & Pratt) and **E** (bench harness) into actual files with scaffolding next.
