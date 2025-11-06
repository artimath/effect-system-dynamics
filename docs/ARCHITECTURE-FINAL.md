# Effect System Dynamics - Final Architecture

**Version**: 3.0 (Validated)
**Date**: 2025-10-30
**Status**: Ready for Implementation

---

## Executive Summary

After deep research into Effect source code and validation against 105+ platform usages, this architecture represents **what Effect authors would actually write** for a system dynamics library.

**Core Decisions**:
1. **Stream-first API** - Primary interface for memory efficiency, cancellation, incremental rendering
2. **Context.Tag services** - Matches platform's 105 usages (not Effect.Tag which has 0)
3. **Pure computation in hot paths** - JIT-optimizable, no Effect overhead per step
4. **Hybrid approach** - Stream primary, but provide eager wrappers for convenience

---

## Philosophical Foundations

### What Is System Dynamics?

System dynamics models **continuous change over time**:
- **Stocks**: Accumulators (e.g., population, inventory, cash balance)
- **Flows**: Rates of change (e.g., birth rate, sales, revenue)
- **Feedback loops**: Circular causality (more users → more value → more users)

**Characteristics**:
- Long-running (1,000-10,000 timesteps typical)
- Memory-intensive (10k steps × 100 stocks = 1M data points)
- User-interruptible ("stop, I've seen enough")
- Visualization-driven (graph updates as it runs)
- Scenario-heavy (run 50-100 variations in parallel)

### Why Stream-First?

After analyzing use cases:

**Interactive Exploration (Lever UI)**:
- User tweaks slider, wants fast feedback (<100ms to first point)
- Render first 100 points while computing rest in background
- **Need**: Pull-based, lazy evaluation
- **Winner**: Stream ✓

**Batch Scenarios (Server API)**:
- Client POSTs "run 50 scenarios", expects JSON
- All results needed for comparison
- **Need**: Eager, all-at-once
- **Winner**: Stream.runCollect ✓ (or Effect.loop, but Stream is more composable)

**Real-time Dashboard**:
- Live metrics flowing through model
- Incremental updates, backpressure handling
- **Need**: Reactive, streaming
- **Winner**: Stream ✓

**Sensitivity Analysis**:
- Vary one parameter, measure final outcome at t=100
- 100 scenarios in parallel, only finals matter
- **Need**: Parallel + eager, but per-scenario streaming
- **Winner**: Effect.forEach + Stream.runLast ✓

**Verdict**: Stream handles all cases through composition. Effect.loop only handles eager case.

---

## Architecture Layers

### Layer 1: Pure Computation (Performance-Critical)

**Purpose**: JIT-optimizable arithmetic, zero Effect overhead

**Pattern**: Plain TypeScript functions, no Effect wrapping

**When to Use**:
- Fixed-timestep numeric integration
- Vector/matrix operations
- Unit conversions
- Pure state transformations

**When NOT to Use**:
- Operations that can fail (validation, equation evaluation)
- Operations that need context (reading services)
- Operations with side effects (logging, I/O)

**Example Decision**:
- Euler step (pure arithmetic): Layer 1 ✓
- RK4 substeps (equation evaluation can fail): Layer 2 ✓

**Key Insight**: Effect is for orchestration, not arithmetic. Let JIT optimize the hot path.

---

### Layer 2: Effect Orchestration (Coordination)

**Purpose**: Compose pure functions with effects that can fail

**Pattern**: Effect.gen wraps pure computation, handles errors

**Service Definition Pattern**:

**Use Context.Tag** (validated: 105 platform usages vs 0 Effect.Tag usages):
```typescript
class ServiceName extends Context.Tag("@scope/ServiceName")<
  ServiceName,
  InterfaceDefinition
>() {}
```

**Embed Layers as Static Properties**:
```typescript
class Solver extends Context.Tag("@org/effect-system-dynamics/Solver")<...>() {
  static Euler = Layer.succeed(this, implementation)
  static RK4 = Layer.effect(this, Effect.gen(...))
}
```

**Why This Pattern**:
- Self-documenting (tag + interface + default layer in one place)
- Discoverable (autocomplete shows `Solver.Euler`, `Solver.RK4`)
- Matches authentic Effect platform style (validated against source)

**When to Use Effect.gen**:
- Calling services (equation evaluator, validators)
- Operations that can fail (Schema.decode, file I/O)
- Composing multiple effects
- Branching based on effectful conditions

---

### Layer 3: Stream Interface (Primary API)

**Purpose**: Memory-efficient, cancellable, incremental time-stepping

**Pattern**: Stream.unfoldEffect for lazy state evolution

**Key Characteristics**:
- **Memory efficient**: Don't hold all 10k timesteps in memory
- **Cancellable**: User can stop long simulation mid-flight
- **Incremental**: UI can render as results arrive
- **Backpressure**: Consumer controls pace
- **Composable**: Rich stream operators (.take, .filter, .map, etc)

**Why unfoldEffect not iterate**:
- `unfoldEffect`: Pull-based lazy generation (consumer controls) ✓
- `iterate`: Push-based eager recursion (producer controls)
- System dynamics is naturally pull-based (render what's visible)

**Why unfoldEffect not Effect.loop**:
- `Effect.loop`: Collects all results into array (memory overhead)
- `Stream.unfoldEffect`: Generates on demand (stream one, GC one)
- Can always wrap: `Stream.runCollect` gives you Effect.loop behavior

**Performance**: Stream overhead is negligible compared to solver computation. Real performance comes from Layer 1 pure functions.

---

### Layer 4: Convenience Wrappers (Sugar)

**Purpose**: Common patterns as single-line convenience functions

**Provided Wrappers**:

**simulateEager**: "Just give me all results"
- For APIs, tests, scenarios needing complete results
- Returns Effect<Array<SimState>>

**simulateFinal**: "Just the last timestep"
- For optimization, sensitivity analysis
- Returns Effect<SimState>

**simulateParallel**: "Run N scenarios concurrently"
- For scenario comparison, Monte Carlo
- Returns `Effect<ReadonlyArray<{ model: Model; id?: string; final: SimState; states?: ReadonlyArray<SimState> }>>`
- Accepts `{ parallelism?: number | "unbounded"; collectStates?: boolean }` to bound concurrency and control materialisation
- Scenario services (`ScenarioService.compare`) surface the same options via `ScenarioRunOptions.parallelism`

**Pattern**: All wrappers compose over Stream primary. Never bypass Stream layer.

---

## Module Organization

### Single Package, Multiple Modules

**Why Not Separate Packages**:
- Scenarios are core to SD (not extension)
- Avoids circular dependencies
- Simpler versioning (one version number)
- Easier development (single typecheck)

**Structure**:
```
@org/effect-system-dynamics/
├─ Model.ts          - Schema definitions (Stock, Flow, Variable, Model)
├─ Solver.ts         - Context.Tag + layers (Euler, RK4, Adaptive)
├─ Simulation.ts     - Stream API + wrappers (simulate, simulateEager, etc)
├─ Equations.ts      - DSL parser + evaluator service
├─ Units.ts          - Branded types + dimensional analysis
├─ Scenarios.ts      - Branching, sensitivity, optimization
├─ Errors.ts         - TypeIdError hierarchy (internal), Schema.TaggedError (boundary)
└─ index.ts          - Public API surface
```

**Separate Packages** (Later):
- `@org/effect-system-dynamics-persistence` - Repos (Spanner, Postgres, etc)
- `@org/effect-system-dynamics-ui` - XYFlow components, charts

**Why Separate Persistence/UI**:
- Core has zero dependencies (Effect only)
- Persistence needs db drivers
- UI needs React, xyflow, charting libs

---

### Model Authoring & Persistence Flow

1. **Visual Builder (Client)**
   - Extend `packages/client/src/features/items/ItemGraphPage.tsx` with SD-specific palettes for stocks, flows, variables, and connectors.
   - Enforce schema parity in the browser: every node mirrors the constructors from `Model.ts`, and equations are validated before submission.
   - Edge semantics follow equation dependencies so users cannot wire invalid graphs.
2. **Transport Contract**
   - Client submits a payload that already satisfies the `Model` schema.
   - Server re-validates with the same schema (Effect schemas are shared) before persisting or running simulations, guaranteeing integrity across hops.
3. **Persistence (Spanner Schemaless)**
   - Encode stocks / flows / variables as typed JSON “nodes” with relationships stored as edges, matching `docs/spanner/schemaless-overview.md`.
   - A dedicated persistence package will expose repositories returning `Effect<Model, RepoError>`; it owns migrations, revision history, and scenario catalogs.
   - `@effect/experimental.Persistence` gives us composable key-value and result caches—great for memoising evaluation or RPC results—but the graph-shaped domain still demands bespoke repositories to keep Spanner schemas explicit and queryable.
4. **Runtime Orchestration**
   - Server fetches models, layers in solver/evaluator/unit services, and invokes simulation or scenario pipelines.
   - Results stream back to clients (time series, scenario deltas, optimisation summaries) while repositories capture revisions for auditing.

**Decisions**
- Parallel simulation keeps a single runtime scope—no per-target layer overrides—to avoid surprising dependency graphs; revisit only if isolation requirements emerge.
- Scenario adapters remain internal so validation and comparison logic stays centralised in `ScenarioService`.

---

## Key Architectural Decisions

### Decision 1: Context.Tag vs Effect.Tag

**Finding**: Platform uses Context.Tag 105 times, Effect.Tag 0 times

**Reasoning**:
- Effect.Tag adds method proxying (`Service.method(...)` as static)
- Platform code doesn't use this pattern (always `yield* Service` then call)
- Context.Tag is established convention

**Verdict**: Use Context.Tag with static layer properties

---

### Decision 2: Stream vs Effect.loop

**Analysis**:

| Aspect | Stream.unfoldEffect | Effect.loop |
|--------|---------------------|-------------|
| Memory | Constant (stream one, GC one) | O(n) array |
| Cancellation | Built-in | Runs to completion |
| Incremental | Natural | Wait for all |
| Composition | Rich operators | Limited |
| Use cases | All 4 scenarios | Only eager |

**Reasoning**:
- Stream handles all use cases through composition
- Effect.loop is just `Stream.runCollect` internally
- Memory matters (10k steps = 10k objects)
- Cancellation matters (user patience finite)

**Verdict**: Stream primary, provide `simulateEager` wrapper for convenience

---

### Decision 3: Pure Functions vs Effect Wrapping

**Analysis**:

**Euler step** (pure arithmetic):
- Input: stocks, flows, dt (all numbers)
- Output: updated stocks (numbers)
- Can fail? No
- Needs context? No
- Side effects? No
- **Verdict**: Layer 1 pure function ✓

**RK4 substeps** (equation evaluation):
- Input: model, state
- Output: rates (can fail if equation invalid)
- Can fail? Yes (undefined variable, division by zero)
- Needs context? Yes (EquationEvaluator service)
- Side effects? No
- **Verdict**: Layer 2 Effect.gen ✓

**Reasoning**: Effect overhead justified when coordination/error-handling needed, not for pure arithmetic.

---

### Decision 4: Schema Validation Location

**Finding**: Effect patterns put constraints IN schemas, not at boundaries

**Pattern**:
```typescript
// ✓ Validation in schema (Effect idiom)
name: Schema.NonEmptyTrimmedString
value: Schema.Number.pipe(Schema.positive)

// ✗ Validation at boundary (imperative style)
name: Schema.String  // validate later
```

**Reasoning**: Schema = contract. Decode validates. Constructor validates. Boundaries trust schema.

**Verdict**: All constraints in schemas using pipes

---

### Decision 5: Error Hierarchy

**Pattern** (from platform source):

**Internal errors** (libraries, pure Effect code):
- Use `TypeIdError(typeId, tag)`
- Lightweight, no schema overhead
- Not serializable (don't need to be)

**Boundary errors** (RPC, HTTP, database):
- Use `Schema.TaggedError`
- Serializable over wire
- Schema-validated

**Specific over generic**:
- Don't make `SolverError` base class
- Make `ConvergenceError`, `InvalidTimeStepError`, etc
- Error channel uses explicit unions: `Effect<A, ErrorA | ErrorB | ErrorC, R>`

**Verdict**: TypeIdError for solver/internal, Schema.TaggedError for RPC boundaries

---

## Performance Targets

### Solver Performance

**Euler (Pure Layer 1)**:
- Target: <10ms per 1000 steps (single stock)
- Bottleneck: Arithmetic only
- Optimization: JIT loves pure functions

**RK4 (Mixed Layer 1+2)**:
- Target: <50ms per 1000 steps (single stock)
- Bottleneck: 4x equation evaluations per step
- Optimization: Batch equation evaluation, cache parsed ASTs

**Adaptive (Layer 2 Heavy)**:
- Target: <200ms per 1000 steps (single stock)
- Bottleneck: Error estimation + dt adjustment
- Optimization: Ref for dt state, minimize Ref.update calls

### Memory Targets

**Stream overhead**: O(1) - constant memory regardless of timestep count

**State size**: ~200 bytes per timestep (100 stocks × 8 bytes × 2 = 1.6KB, amortized)

**Total for 10k steps**: ~2MB in stream, ~20MB if collected to array

---

## Extension Points

### Solver Plugins

**Pattern**: New solver = new Layer
```typescript
class Solver extends Context.Tag(...)<...>() {
  static Euler = Layer.succeed(this, ...)
  static RK4 = Layer.effect(this, ...)
  static Adaptive = Layer.effect(this, ...)
  static MonteCarlo = Layer.effect(this, ...)  // User extension
}
```

**Contract**: Must implement `step: (model, state, dt) => Effect<SimState, SolverError>`

### Equation Backends

**Pattern**: Equation evaluator as service
```typescript
class EquationEvaluator extends Context.Tag(...)<...>() {
  static ASTInterpreter = Layer.effect(this, ...)  // Default
  static CompiledJS = Layer.effect(this, ...)      // Extension: compile to JS
  static WASM = Layer.effect(this, ...)            // Extension: compile to WASM
}
```

**Contract**: Must implement `evaluate: (equation, context) => Effect<number, EquationError>`

**Graph Execution (Current Default)**
- Variables compile into a dependency DAG using a Kahn-style topological pass backed by Effect’s `Graph` utilities.
- Per-model caches avoid recomputing the order each solver step.
- Cycles fail fast with rich `EquationGraphCycleError` metadata so upstream callers can surface meaningful diagnostics.

### Persistence Backends

**Pattern**: Repository as service (separate package)
```typescript
class ModelRepository extends Context.Tag(...)<...>() {
  static Memory = Layer.succeed(this, ...)       // Testing
  static Spanner = Layer.effect(this, ...)       // Lever production
  static Postgres = Layer.effect(this, ...)      // Self-hosted
}
```

**Contract**: CRUD operations returning `Effect<Model, RepoError, Connection>`

---

## Testing Strategy

### Unit Tests (Pure Functions)

**Pattern**: Regular vitest, no Effect needed
```typescript
describe("pureEulerStep", () => {
  it("updates stocks by flow * dt", () => {
    const result = pureEulerStep({pop: 100}, {growth: 5}, 0.1)
    expect(result.pop).toBe(100.5)
  })
})
```

### Integration Tests (Services)

**Pattern**: @effect/vitest with test layers
```typescript
import { it } from "@effect/vitest"

it.effect("simulates population growth", () =>
  Effect.gen(function*() {
    const model = makePopulationModel()
    const result = yield* simulateEager(model)
    expect(result.length).toBe(100)
  }).pipe(Effect.provide(Solver.Euler))
)
```

### Property Tests (Effect.Arbitrary)

**Pattern**: Generate random models, verify invariants
```typescript
it.effect("stock values never go negative", () =>
  Effect.gen(function*() {
    const model = yield* Arbitrary.model
    const states = yield* simulateEager(model)
    states.forEach(state =>
      expect(Object.values(state.stocks).every(v => v >= 0)).toBe(true)
    )
  })
)
```

---

## Migration Path (From V2 to V3)

### Breaking Changes

1. **Stream primary** (was Effect returning array)
2. **Context.Tag** (was Context.GenericTag)
3. **Static layers** (was separate export)
4. **Pure solvers** (was Effect-wrapped per step)

### Compatibility Layer

Provide v2 compatibility:
```typescript
// V2 API (deprecated)
export const simulateArray = (model: Model): Effect<Array<SimState>> =>
  simulateEager(model)  // wrapper

// V3 API (preferred)
export const simulate = (model: Model): Effect<Stream<SimState>> => ...
```

---

## Documentation Requirements

### User-Facing Docs

1. **Getting Started** - 5 minute quickstart
2. **Core Concepts** - Stock/Flow/Variable explained
3. **Solvers Guide** - When to use Euler vs RK4
4. **Equation DSL** - Syntax reference
5. **Scenarios** - Branching, sensitivity, optimization
6. **API Reference** - Generated from TSDoc

### Developer Docs

1. **Architecture** - This document
2. **Contributing** - How to add solvers/equations
3. **Testing** - Unit/integration/property patterns
4. **Performance** - Profiling guide
5. **Extensions** - Plugin system

---

## Success Criteria

### Technical

- ✅ All tests passing (unit, integration, property)
- ✅ Typecheck clean with strict mode
- ✅ Zero Effect anti-patterns (validated against platform source)
- ✅ <10ms p95 for Euler 1000-step simulation
- ✅ <2MB memory for 10k-step stream
- ✅ Schema-validated at every boundary

### Product

- ✅ Demo: business model → simulate → leverage points
- ✅ Publishable to npm with clean README
- ✅ Zero domain assumptions (works for physics, ecology, economics)
- ✅ Works with Effect 3.18+ (current stable)

### Architectural

- ✅ Solvers swappable via Layer
- ✅ Stream-first API with eager wrappers
- ✅ Pure functions in hot paths
- ✅ Context.Tag services with static layers
- ✅ Units validated with dimensional analysis
- ✅ Composable with Effect ecosystem (RPC, SQL, Streams, etc)

---

## What Makes This "Effect-Idiomatic"

After validating against 105+ platform usages:

1. **Context.Tag for services** - Not Effect.Tag (platform: 105 vs 0)
2. **Static layer properties** - Tag + layers in one declaration
3. **Stream for sequences** - Memory-efficient, cancellable, composable
4. **Pure computation at boundaries** - Effect for coordination, not arithmetic
5. **Schema-first validation** - Constraints in schemas, not at boundaries
6. **TypeIdError internally** - Lightweight, specific errors
7. **Effect.gen for composition** - Readable, sequential, type-safe
8. **Layer for dependency injection** - Swappable implementations

**This is what Effect authors write in production.**

---

## Next: Implementation (See ATOMIC-PRS.md)
