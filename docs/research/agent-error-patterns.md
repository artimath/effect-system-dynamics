# Authentic Effect.ts Error Handling Patterns

**Research Date**: 2025-10-30
**Researcher**: Claude (Sonnet 4.5)
**Sources**: Effect source code, Effect docs, internal lever codebase patterns

---

## Executive Summary

**Do our error patterns match Effect's authentic style?**

tl;dr: your architecture doc suggests `SolverError`, `EquationError` but you haven't implemented them yet. this is the right time to get it right.

**Effect's canonical error pattern:**
1. Use `Schema.TaggedError<Self>()("TagName", fields)` for domain errors
2. For platform-style packages: optionally use `TypeIdError(typeId, tag)` to create a shared type id hierarchy
3. Always include a `get message()` getter for human-readable error messages
4. Use the error channel explicitly in Effect types: `Effect<A, E, R>`
5. Catch errors with `Effect.catchTag`, `Effect.catchTags`, or `Effect.catchAll`

**What you should implement:** hybrid approach matching both platform patterns (type id hierarchy) and domain patterns (Schema.TaggedError).

---

## 1. Error Definition Patterns

### Pattern A: Schema.TaggedError (Domain Errors)

**When to use:** Application-level domain errors (OGP nodes/edges, cognitive system, todos)

**Example from lever/domain:**
```typescript
// packages/domain/src/ogp/errors.ts
export class NodeNotFoundError extends Schema.TaggedError<NodeNotFoundError>()(
  "NodeNotFoundError",
  {
    id: NodeId,
  },
) {}

export class GraphValidationError extends Schema.TaggedError<GraphValidationError>()(
  "GraphValidationError",
  {
    message: Schema.String,
    details: Schema.optional(Schema.Unknown),
  },
) {}
```

**Why this pattern:**
- Errors are schema-validated (can be serialized over RPC)
- Auto-generates `_tag` discriminator for `Effect.catchTag`
- Works with Effect's type inference
- Can be used in HttpApi error responses

**Effect platform example:**
```typescript
// @effect/platform/src/Error.ts
export class BadArgument extends Schema.TaggedError<BadArgument>("@effect/platform/Error/BadArgument")(
  "BadArgument",
  {
    module: Module,
    method: Schema.String,
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect)
  }
) {
  readonly [TypeId]: typeof TypeId = TypeId

  get message(): string {
    return `${this.module}.${this.method}${this.description ? `: ${this.description}` : ""}`
  }
}
```

### Pattern B: TypeIdError (Platform/Library Errors)

**When to use:** Infrastructure errors for libraries that need type id hierarchies

**Example from lever packages:**
```typescript
// packages/effect-spanner-graph/src/Error.ts
export const SpannerGraphErrorTypeId: unique symbol = Symbol.for(
  "@org/effect-spanner-graph/SpannerGraphError",
);

export class SpannerGraphError extends TypeIdError(SpannerGraphErrorTypeId, "SpannerGraphError")<{
  cause: unknown;
  message?: string;
  requestId?: string;
}> {}

export class NodeNotFound extends TypeIdError(SpannerGraphErrorTypeId, "NodeNotFound")<{
  nodeId: string;
}> {
  get message() {
    return `Node ${this.nodeId} not found`;
  }
}
```

**Why this pattern:**
- All errors share same `TypeId` for `isPlatformError`-style refinements
- Lighter weight than Schema.TaggedError (no schema validation)
- Still yieldable in `Effect.gen`
- Use when errors don't need to cross RPC boundaries

### Pattern C: Data.TaggedError (Lightweight Yieldable)

**When to use:** Internal errors that don't need schema validation or serialization

**Effect docs example:**
```typescript
import { Effect, Data } from "effect"

class FooError extends Data.TaggedError("Foo")<{
  message: string
}> {}

const program = Effect.gen(function* () {
  const n = yield* Random.next
  return n > 0.5
    ? "yay!"
    : yield* new FooError({ message: "Oh no!" })
})
```

**Why this pattern:**
- Simplest option - just `Data.Error` + automatic `_tag`
- No schema validation overhead
- Still works with `Effect.catchTag`
- Use for internal service boundaries only

---

## 2. Recommended Pattern for System Dynamics

**Use hybrid approach:**
- **Public API errors:** `Schema.TaggedError` (serializable, validated)
- **Internal errors:** `TypeIdError` (type id hierarchy, lightweight)

### Implementation Plan

```typescript
// packages/effect-system-dynamics/src/Error.ts

import { TypeIdError } from "@effect/platform/Error";
import * as Schema from "effect/Schema";

/**
 * @category type ids
 * @since 1.0.0
 */
export const SystemDynamicsErrorTypeId: unique symbol = Symbol.for(
  "@org/effect-system-dynamics/Error"
);

export type SystemDynamicsErrorTypeId = typeof SystemDynamicsErrorTypeId;

// ---- Equation Errors (internal) ----

/**
 * Base error for equation evaluation
 */
export class EquationError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "EquationError"
)<{
  expression: string;
  cause: unknown;
  message?: string;
}> {
  get message() {
    return this.message ?? `Equation evaluation failed: ${this.expression}`;
  }
}

/**
 * Undefined variable in equation
 */
export class UndefinedVariableError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "UndefinedVariableError"
)<{
  variable: string;
  expression: string;
  availableVariables: ReadonlyArray<string>;
}> {
  get message() {
    return `Undefined variable "${this.variable}" in "${this.expression}". Available: ${this.availableVariables.join(", ")}`;
  }
}

/**
 * Circular dependency detected in equations
 */
export class CircularDependencyError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "CircularDependencyError"
)<{
  cycle: ReadonlyArray<string>;
}> {
  get message() {
    return `Circular dependency detected: ${this.cycle.join(" → ")}`;
  }
}

// ---- Solver Errors (internal) ----

/**
 * Base error for solver operations
 */
export class SolverError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "SolverError"
)<{
  cause: unknown;
  message?: string;
}> {
  get message() {
    return this.message ?? "Solver error";
  }
}

/**
 * Solver failed to converge
 */
export class ConvergenceError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "ConvergenceError"
)<{
  steps: number;
  tolerance: number;
  error: number;
}> {
  get message() {
    return `Solver failed to converge after ${this.steps} steps (error: ${this.error}, tolerance: ${this.tolerance})`;
  }
}

/**
 * Invalid model configuration
 */
export class ModelValidationError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "ModelValidationError"
)<{
  reason: string;
  details?: unknown;
}> {
  get message() {
    return `Model validation failed: ${this.reason}`;
  }
}

// ---- Unit Errors (internal) ----

/**
 * Dimensional analysis error
 */
export class UnitError extends TypeIdError(
  SystemDynamicsErrorTypeId,
  "UnitError"
)<{
  reason: string;
  from?: string;
  to?: string;
}> {
  get message() {
    if (this.from && this.to) {
      return `Cannot convert ${this.from} to ${this.to}: ${this.reason}`;
    }
    return `Unit error: ${this.reason}`;
  }
}

// ---- Public API Errors (for RPC/HTTP) ----

/**
 * Model not found (404)
 */
export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()(
  "ModelNotFoundError",
  {
    modelId: Schema.String,
  }
) {}

/**
 * Scenario not found (404)
 */
export class ScenarioNotFoundError extends Schema.TaggedError<ScenarioNotFoundError>()(
  "ScenarioNotFoundError",
  {
    scenarioId: Schema.String,
  }
) {}

/**
 * Invalid simulation parameters (400)
 */
export class SimulationError extends Schema.TaggedError<SimulationError>()(
  "SimulationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

// ---- Type Guards ----

export const isSystemDynamicsError = (u: unknown): u is EquationError | SolverError | UnitError | ModelValidationError =>
  typeof u === "object" && u !== null && SystemDynamicsErrorTypeId in u;
```

---

## 3. Error Channel Usage

**Effect's error channel pattern:**

```typescript
// Service methods return Effect<Success, Error, Requirements>
export interface SimulationService {
  readonly run: (
    model: Model
  ) => Effect.Effect<SimResult, SolverError | EquationError>

  readonly validate: (
    model: Model
  ) => Effect.Effect<boolean, ModelValidationError>
}
```

**Key principles:**
1. **Explicit error types:** Don't use `unknown` - list specific error tags
2. **Union errors:** Multiple failure modes = union type in E channel
3. **Error refinement:** Use `Effect.catchTag` to handle specific errors
4. **Error transformation:** `Effect.mapError` to convert error types between layers

**Example from architecture doc (corrected):**

```typescript
// BEFORE (architecture doc suggests this):
export interface EquationEvaluator {
  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, EquationError>
}

// CORRECT (explicit error types):
export interface EquationEvaluator {
  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, UndefinedVariableError | CircularDependencyError | EquationError>
}
```

---

## 4. Recovery Patterns

### Pattern A: catchTag (Handle Specific Error)

```typescript
// Effect platform pattern
yield* fileSystem.readFile(path).pipe(
  Effect.catchTag("SystemError", (e) =>
    e.reason === "NotFound"
      ? Effect.succeed(false)
      : Effect.fail(e)
  )
)
```

**Your system dynamics example:**
```typescript
const result = yield* equationEvaluator.evaluate(equation, context, time).pipe(
  Effect.catchTag("UndefinedVariableError", (err) =>
    // If variable is time-dependent, use default value
    Effect.succeed(0)
  ),
  Effect.catchTag("CircularDependencyError", (err) =>
    // Log cycle and fail gracefully
    Effect.flatMap(
      Effect.logError(`Circular dependency: ${err.cycle.join(" → ")}`),
      () => Effect.fail(new ModelValidationError({
        reason: "Circular dependency in equations"
      }))
    )
  )
)
```

### Pattern B: catchTags (Handle Multiple Errors)

```typescript
const program = Effect.gen(function* () {
  const n = yield* Random.next
  return n > 0.5
    ? "yay!"
    : n < 0.2
    ? yield* new FooError({ message: "Oh no!" })
    : yield* new BarError({ randomNumber: n })
}).pipe(
  Effect.catchTags({
    Foo: (error) => Effect.succeed(`Foo error: ${error.message}`),
    Bar: (error) => Effect.succeed(`Bar error: ${error.randomNumber}`)
  })
)
```

### Pattern C: catchAll (Handle Any Error)

```typescript
const withErrorHandling = Effect.catchAll(program, (error) =>
  Effect.gen(function* () {
    yield* Effect.logError("Unexpected error", error)
    return defaultValue
  })
)
```

### Pattern D: retry (Retry Transient Failures)

```typescript
// Effect platform pattern
const withRetry = httpClient.get("/api").pipe(
  Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(
    Schedule.compose(Schedule.recurs(3))
  ))
)
```

**Your solver example:**
```typescript
const convergedResult = yield* solver.step(model, state, dt).pipe(
  Effect.retry(Schedule.recurs(3).pipe(
    Schedule.whileInput((err) => err._tag === "ConvergenceError")
  )),
  Effect.catchTag("ConvergenceError", (err) =>
    // If still not converged after retries, reduce time step
    solver.step(model, state, dt / 2)
  )
)
```

---

## 5. Testing Error Scenarios

### Effect's Test Patterns

**From Effect docs:**
```typescript
import { assert, describe, it } from "@effect/vitest"

it.effect("should fail with specific error", () =>
  Effect.gen(function* () {
    const result = yield* Effect.flip(failingOperation())
    assert.strictEqual(result._tag, "MyError")
  })
)
```

**Your system dynamics tests:**

```typescript
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

describe("EquationEvaluator", () => {
  it.effect("should fail with UndefinedVariableError", () =>
    Effect.gen(function* () {
      const evaluator = yield* EquationEvaluator
      const equation = new Equation({
        expression: "x + y",
        references: ["x", "y"]
      })
      const context = new Map([["x", 10]]) // missing y

      const result = yield* Effect.flip(
        evaluator.evaluate(equation, context, 0)
      )

      assert.strictEqual(result._tag, "UndefinedVariableError")
      assert.strictEqual(result.variable, "y")
    })
  )

  it.effect("should detect circular dependencies", () =>
    Effect.gen(function* () {
      const evaluator = yield* EquationEvaluator
      const model = new Model({
        // ... model with a → b → c → a cycle
      })

      const result = yield* Effect.flip(
        evaluator.buildGraph(model)
      )

      assert.strictEqual(result._tag, "CircularDependencyError")
      assert.deepStrictEqual(result.cycle, ["a", "b", "c", "a"])
    })
  )

  it.effect("should recover with catchTag", () =>
    Effect.gen(function* () {
      const evaluator = yield* EquationEvaluator
      const equation = new Equation({
        expression: "unknown_var",
        references: ["unknown_var"]
      })

      const result = yield* evaluator.evaluate(equation, new Map(), 0).pipe(
        Effect.catchTag("UndefinedVariableError", () => Effect.succeed(0))
      )

      assert.strictEqual(result, 0)
    })
  )
})
```

---

## 6. Comparison: Architecture Doc vs Authentic Patterns

### What Architecture Doc Got Right

✅ Using Effect types for all operations
✅ Composing errors via union types
✅ Separate error types for different concerns (Solver, Equation, Unit)

### What Needs Correction

❌ **Architecture doc:**
```typescript
export interface EquationEvaluator {
  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, EquationError>  // too generic
}
```

✅ **Authentic Effect pattern:**
```typescript
export interface EquationEvaluator {
  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, UndefinedVariableError | CircularDependencyError | EquationError>
}
```

❌ **Architecture doc suggests:**
```typescript
export class SolverError extends Schema.Class<SolverError>("SolverError")({
  cause: unknown;
  message?: string;
}) {}
```

✅ **Authentic Effect pattern:**
```typescript
export class SolverError extends TypeIdError(SystemDynamicsErrorTypeId, "SolverError")<{
  cause: unknown;
  message?: string;
}> {
  get message() {
    return this.message ?? "Solver error";
  }
}
```

### Key Differences

| Aspect | Architecture Doc | Authentic Effect |
|--------|-----------------|------------------|
| Base class | `Schema.Class` | `TypeIdError` (internal) or `Schema.TaggedError` (public) |
| Error hierarchy | Flat | Shared `TypeId` for refinements |
| Message getter | Missing | Always included |
| Error specificity | Generic base errors | Specific error constructors |
| Serialization | All errors use Schema | Only public API errors need Schema |

---

## 7. Recommendations

### Immediate Changes

1. **Use TypeIdError for internal errors:**
   - EquationError → specific constructors (UndefinedVariableError, CircularDependencyError)
   - SolverError → specific constructors (ConvergenceError, InvalidTimeStepError)
   - UnitError → specific constructors (IncompatibleUnitsError, UnknownUnitError)

2. **Use Schema.TaggedError for public API errors:**
   - ModelNotFoundError (404)
   - ScenarioNotFoundError (404)
   - SimulationError (400)

3. **Add message getters to all errors:**
   ```typescript
   get message() {
     return `Descriptive error: ${this.details}`;
   }
   ```

4. **Make error types explicit in Effect signatures:**
   ```typescript
   // Instead of: Effect<A, EquationError, R>
   // Use: Effect<A, UndefinedVariableError | CircularDependencyError, R>
   ```

5. **Create error type guards:**
   ```typescript
   export const isSystemDynamicsError = (u: unknown): u is SystemDynamicsError =>
     typeof u === "object" && u !== null && SystemDynamicsErrorTypeId in u;
   ```

### Code Examples

**File:** `packages/effect-system-dynamics/src/Error.ts`

See section 2 for complete implementation.

**Service signature updates:**

```typescript
// packages/effect-system-dynamics/src/EquationEvaluator.ts
export interface EquationEvaluator {
  readonly buildGraph: (
    model: Model
  ) => Effect.Effect<Graph.Graph<string, unknown>, CircularDependencyError | ModelValidationError>

  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, UndefinedVariableError | EquationError>

  readonly evaluateAll: (
    model: Model,
    state: SimState
  ) => Effect.Effect<Map<string, number>, UndefinedVariableError | CircularDependencyError | EquationError>
}
```

**Solver with specific errors:**

```typescript
// packages/effect-system-dynamics/src/Solver.ts
export interface Solver {
  readonly step: (
    model: Model,
    state: SimState,
    dt: number
  ) => Effect.Effect<SimState, ConvergenceError | ModelValidationError>
}
```

**Unit manager with specific errors:**

```typescript
// packages/effect-system-dynamics/src/UnitManager.ts
export interface UnitManager {
  readonly convert: (
    value: number,
    from: Unit,
    to: Unit
  ) => Effect.Effect<number, UnitError>

  readonly validate: (
    equation: Equation,
    context: Map<string, Unit>
  ) => Effect.Effect<boolean, UnitError>
}
```

---

## 8. Migration Path

### Phase 1: Define Error Hierarchy (Week 1)
- Create `src/Error.ts` with TypeIdError hierarchy
- Add Schema.TaggedError for public API
- Add message getters to all errors
- Export error union types

### Phase 2: Update Service Signatures (Week 1-2)
- Change `EquationEvaluator` signatures to use specific errors
- Change `Solver` signatures to use specific errors
- Change `UnitManager` signatures to use specific errors
- Run `pnpm check` to catch all type errors

### Phase 3: Add Error Handling (Week 2)
- Add `Effect.catchTag` for specific recoveries
- Add `Effect.retry` for transient failures
- Add `Effect.catchAll` for fallback cases
- Test error paths with `Effect.flip`

### Phase 4: Write Tests (Week 2)
- Test each error constructor
- Test error recovery patterns
- Test error propagation through layers
- Test error serialization (for RPC errors)

---

## Conclusion

**Your architecture is 80% there.** The core insight—use Effect for everything—is correct. The main gaps:

1. Use `TypeIdError` for internal library errors (not `Schema.Class`)
2. Use `Schema.TaggedError` for RPC/HTTP errors
3. Create specific error constructors (not generic base classes)
4. Add `get message()` to every error
5. Be explicit about error types in Effect signatures

**The pattern you should follow:**
- Look at `@effect/platform/Error.ts` for TypeIdError hierarchy
- Look at `lever/packages/domain/src/ogp/errors.ts` for Schema.TaggedError
- Look at `lever/packages/effect-gql/src/GqlError.ts` for package-level errors
- Combine both patterns based on whether errors cross boundaries

This matches how Effect authors actually build libraries. Your code will look like it belongs in `@effect/system-dynamics`.
