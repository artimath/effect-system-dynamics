# Equation DSL Parser & AST – Implementation Plan (PR-30B)

## Overview
Objective: replace the ad-hoc parser with a structured AST pipeline that supports PR-30’s target DSL features, while maintaining backward compatibility and aligning with Effect idioms.

## Guiding Principles
- Functional first: pure transforms from source → AST, AST → evaluation IR.
- Incremental rollout: feature flag gating, existing evaluator remains default until parity achieved.
- Test-driven: regression & fixture suites must stay green at every step.
- Observability: rich error reporting (line/column/snippet) from the outset.

## Milestones & Tasks

### M1. Parse Tree Visitor & AST Skeleton
- [ ] Introduce a canonical AST module (discriminated unions + Effect `Schema.Struct` wrappers).
- [ ] Build a parse-tree visitor for the existing ANTLR grammar that covers current constructs (numeric literals, references, arithmetic, function calls).
- [ ] Produce snapshot tests verifying AST output for baseline expressions.

### M2. Extend AST to Target Constructs
- [ ] Add node types for conditionals, lookups, delays, time primitives, macros.
- [ ] Update visitor to map grammar nodes → AST (even if evaluator support lands later).
- [ ] Document AST schema for persistence/UI consumption (export via `Schema`).

### M3. Effect Integration & Feature Flag
- [ ] Define parser entry point: `EquationParser.parse(effect)` returning `Effect<EquationAst, EquationParseError>`.
- [ ] Wire feature flag (`EquationDsl.v2`) to switch between legacy evaluation vs new AST path (parsing + interpreter stub).
- [ ] Ensure error reporting surfaces precise positions using ANTLR token metadata.

### M4. Comprehensive Test Suite (Production Gate)
- [ ] Build `test/EquationDSL/` with:
  - Golden AST snapshots per construct category.
  - Fixture-based tests using reference models (odex/simulation) to validate parse output.
  - Negative tests for unit mismatches, dangling operators, unsupported constructs.
- [ ] Integrate property-based tests for algebraic equivalence (where possible).
- [ ] CI guard: suite must run under feature-flag path and legacy path.

### M5. Documentation & Developer Experience
- [ ] Update `Equation-DSL.md` with AST examples, error semantics, and parser usage.
- [ ] Provide migration notes for adding new functions/macros (guide for future contributors).
- [ ] Prepare dev tooling scripts: `pnpm parse:ast <expr>` for quick inspection.

## Dependencies / Inputs
- Target grammar & constructs (from `Equation-DSL.md`).
- Existing grammar file `Formula.g`; consider trimming once AST coverage is complete.
- Reference models from odex-js & simulation repositories.

## Risks & Mitigations
- **Grammar complexity**: If ANTLR visitor becomes unwieldy, switch to a lighter parser generator (per GPT-5-pro recommendation). Mitigation: encapsulate visitor behind interface so backend swap is possible.
- **Performance regressions**: AST construction should stay linear; benchmark against large models before rollout.
- **Unit semantics drift**: Maintain shared helpers with evaluator to ensure dimension checking stays consistent.

## Deliverables by PR-30B Completion
- AST module and parser transformer merged under feature flag.
- Green regression suite covering all baseline constructs.
- Documentation & developer tooling for AST inspection.
- Clear TODO list feeding PR-30C (Evaluator integration) and PR-30D (Docs/migration polishing).

