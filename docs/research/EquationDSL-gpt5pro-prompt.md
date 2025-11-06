# Prompt: Effect-Idiomatic Equation DSL Parser & AST

## Context
- Project: `@org/effect-system-dynamics`
- Runtime: Effect 3.18+, TypeScript (ESM)
- Existing code: quantity-aware solver ecosystem, current parser generated via ANTLR grammar (`Formula.g`) but evaluator only supports arithmetic + basic logic.
- Goal: replace/augment the current pipeline with a minimal, maintainable grammar & parser that outputs an AST perfectly aligned with Effect idioms (pure functions, Context/Layer wiring, Schema support).

## Problem Statement
Design an equation parsing strategy tailored for system dynamics models that:
1. Supports the target DSL surface (conditionals, lookup tables, delay/smooth functions, macros) while remaining minimal.
2. Emits an AST optimized for Effect-based evaluation (immutable structures, quantity/unit metadata, schema-friendly).
3. Avoids heavyweight dependencies unless justified (ANTLR acceptable only if there’s no better alternative).
4. Enables incremental adoption alongside the existing evaluator (feature flag + compatibility mode).

## Requirements & Constraints
- **Language Targets**
  - Arithmetic: `+ - * / % ^`
  - Boolean logic & comparisons
  - Conditionals: `IF … THEN … ELSEIF … ELSE … END IF`
  - Lookup tables (1-D, possibly 2-D) with explicit unit annotations
  - Delay / smooth functions: `DELAY1`, `DELAY3`, `SMOOTH`, `SMOOTH3`
  - Time primitives: `TIME`, `TIME STEP`, `INITIAL TIME`, `FINAL TIME`
  - Pure macros: `FUNCTION name(params) … END FUNCTION`
  - Literals with units: `5 { people / tick }`
  - References: `[StockName]`

- **Effect Integration**
  - Output AST nodes should be defined as tagged unions or Schema-based structs compatible with Effect’s `Schema.Class` / `Schema.Struct`, enabling validation & serialization.
  - Parser should expose `Effect.Effect<EquationAst, EquationParseError>` signatures (or pure function returning `Either`).
  - Embrace functional patterns (no hidden mutable state, no global caches).

- **Tooling Expectations**
  - Prefer minimal parser generators (e.g. nearley, chevrotain) if they reduce complexity vs ANTLR.
  - If ANTLR remains the best option, outline how to slim the grammar & produce a clean visitor that maps directly to the AST.
  - Provide algorithmic notes on handling precedence, associativity, and unit annotations.

- **Migration Strategy**
  - Proposal must support coexistence with the current evaluator until full feature parity is achieved (e.g. feature flag, legacy fallback).
  - Must address error reporting (line/column, snippet) and maintain or improve current precision.
  - Outline testing hooks (golden parse trees, property tests, reference fixtures).

## Deliverables Requested from GPT-5-pro
1. **Architecture Overview**: recommended parser approach, trade-offs vs alternatives, and why it fits Effect idioms.
2. **Grammar Sketch**: concise EBNF (or equivalent) that captures required constructs without the legacy baggage.
3. **AST Design**: TypeScript type definitions (or Schema declarations) demonstrating the proposed node structure, including unit metadata handling.
4. **Parsing Strategy**: how to transform parse tree → AST, including visitor/walker patterns and unit literal handling.
5. **Integration Notes**: how to wire into Effect layers, caching, and evaluation flow; mention feature gating and compatibility.
6. **Testing Plan**: recommended suites (golden tests, property tests, fixture-based comparisons) and how they validate equivalence with reference models.
7. **Potential Pitfalls**: expected edge cases (e.g., conditionals with mismatched units, lookup interpolation issues) and suggested mitigations.

## Additional Resources
- Current grammar: `packages/effect-system-dynamics/src/internal/equations/grammar/Formula.g`
- Current evaluator: `packages/effect-system-dynamics/src/internal/equations/EquationEngine.ts`
- Quantity utilities: `packages/effect-system-dynamics/src/internal/equations/Quantity.ts`
- DSL target spec: `packages/effect-system-dynamics/docs/Equation-DSL.md`

## Output Format
Please respond with a structured proposal:
1. Summary (<= 5 sentences)
2. Detailed sections matching the deliverables above
3. Explicit TODO checklist we can translate into atomic PR tasks
4. Any assumptions or follow-up questions to resolve before implementation

