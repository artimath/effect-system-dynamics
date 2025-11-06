# Effect Stream & Iteration Patterns Research

**Date**: 2025-10-30
**Agent**: Claude Code
**Task**: Validate Stream usage patterns vs authentic Effect.ts style

---

## Executive Summary

your architecture doc uses `Stream.unfold` for time-stepping simulation, but this is **wrong for your use case**. authentic effect pattern for simulation is `Effect.loop` not streams.

**why**: streams are for **backpressure** and **pull-based lazy evaluation** when you have consumers that control flow. your simulation is **eager evaluation** where you want all timesteps computed immediately.

**correct pattern**: `Effect.loop` with state accumulation, then wrap final result in Stream if needed for presentation.

---

## Stream.unfold vs iterate vs scan

### Stream.unfold
```typescript
// signature
declare const unfold: <S, A>(
  s: S,
  f: (s: S) => Option.Option<readonly [A, S]>
) => Stream<A>

// example from docs
const stream = Stream.unfold(1, (n) => Option.some([n, n + 1]))
Effect.runPromise(Stream.runCollect(stream.pipe(Stream.take(5))))
// { _id: 'Chunk', values: [ 1, 2, 3, 4, 5 ] }
```

**semantics**: "peel layers off a value". returns Option to signal termination. pure function, no effects.

**use when**: generating values from state where consumer controls backpressure (pagination, infinite streams).

### Stream.iterate
```typescript
// signature
declare const iterate: <A>(value: A, next: (value: A) => A) => Stream<A>

// example
const stream = Stream.iterate(1, (n) => n + 1)
Effect.runPromise(Stream.runCollect(stream.pipe(Stream.take(10))))
// { _id: 'Chunk', values: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ] }
```

**semantics**: infinite iteration `a, f(a), f(f(a))...`. no termination condition built-in.

**use when**: infinite sequences where consumer decides when to stop via `take/takeWhile/takeUntil`.

### Stream.scan
```typescript
// signature
declare const scan: <S, A>(s: S, f: (s: S, a: A) => S) => <E, R>(self: Stream<A, E, R>) => Stream<S, E, R>

// example from docs
const stream = Stream.range(1, 6).pipe(Stream.scan(0, (a, b) => a + b))
Effect.runPromise(Stream.runCollect(stream))
// { _id: 'Chunk', values: [ 0, 1, 3, 6, 10, 15, 21 ] }
```

**semantics**: stateful accumulation over existing stream. like Array.reduce but emits intermediate results.

**use when**: you have a stream and need running totals/accumulation.

### Stream.mapAccum
```typescript
// signature
declare const mapAccum: <S, A, A2>(
  s: S,
  f: (s: S, a: A) => readonly [S, A2]
) => <E, R>(self: Stream<A, E, R>) => Stream<A2, E, R>

// example from tests
const runningTotal = (stream: Stream<number>): Stream<number> =>
  stream.pipe(Stream.mapAccum(0, (s, a) => [s + a, s + a]))

Stream.range(0, 6) // 0,1,2,3,4,5,6
  .pipe(runningTotal)
  .pipe(Stream.runCollect)
// { _id: "Chunk", values: [ 0, 1, 3, 6, 10, 15, 21 ] }
```

**semantics**: map + accumulate state. emits transformed values while threading state.

**use when**: transforming stream elements with stateful computation.

---

## Effect.loop - The Correct Pattern for Simulation

```typescript
// signature
declare const loop: <A, C, E, R>(
  initial: A,
  options: {
    readonly while: (a: A) => boolean
    readonly step: (a: A) => A
    readonly body: (a: A) => Effect<C, E, R>
    readonly discard?: boolean
  }
) => Effect<Array<C>, E, R> | Effect<void, E, R>

// example
const result = Effect.loop(
  1, // initial state
  {
    while: (state) => state <= 5,
    step: (state) => state + 1,
    body: (state) => Effect.succeed(state)
  }
)
// Returns: Effect<Array<number>> -> [1, 2, 3, 4, 5]
```

**semantics**: effectful while loop with state. collects or discards results.

**use when**:
- eager computation where you want all results immediately
- effectful state transitions (queries, mutations, complex logic)
- bounded iteration with clear termination
- **simulation time-stepping** ✅

---

## Stateful Streams with Ref

pattern: when you need **mutable state** inside stream operations, use `Ref` in the effect context.

```typescript
// from effect tests
Effect.gen(function*() {
  const ref = yield* Ref.make<Array<number>>([])

  yield* Effect.loop(0, {
    while: (n) => n < 5,
    step: (n) => n + 1,
    body: (n) => Ref.update(ref, Array.append(n))
  })

  const result = yield* Ref.get(ref)
  // result: [0, 1, 2, 3, 4]
})
```

**key insight**: effect authors use `Ref` for accumulation, not stream state. stream is lazy/pull, Ref is eager/mutable.

---

## Performance Patterns

### chunking
streams emit `Chunk<A>` not `A` for amortized performance. default chunk size:

```typescript
export const DefaultChunkSize: number = 4096
```

but simulation doesn't benefit from chunking - you compute all states eagerly.

### backpressure
streams have **pull-based backpressure** - consumer controls flow rate. simulation has no consumer pulling, you want immediate batch computation.

### batching
if simulation results need batching for UI/storage, do it AFTER computation:

```typescript
// collect all states eagerly
const states = yield* Effect.loop(initialState, {...})

// then stream if needed for incremental rendering
const stream = Stream.fromIterable(states).pipe(
  Stream.rechunk(100), // batch into chunks of 100
  Stream.schedule(Schedule.fixed("100 millis")) // pace for UI
)
```

---

## Comparison: Your Simulation vs Authentic Effect

### Your Architecture Doc (WRONG ❌)
```typescript
export const simulate = (
  model: Model
): Effect.Effect<Stream.Stream<SimState, SolverError>, SolverError, Solver> =>
  Effect.gen(function* () {
    const solver = yield* Solver
    const initialState = yield* initializeState(model)

    return Stream.unfold(initialState, (state) =>
      Effect.gen(function* () {
        if (state.time >= model.timeConfig.end) {
          return Option.none()
        }

        const nextState = yield* solver.step(
          model,
          state,
          model.timeConfig.step
        )

        return Option.some([state, nextState])
      })
    )
  })
```

**problems**:
1. `Stream.unfold` doesn't accept `Effect` in the stepper - you're mixing metaphors
2. lazy pull-based evaluation when you want eager batch computation
3. no consumer to control backpressure
4. returns `Effect<Stream<...>>` - double wrapping for no benefit

### Authentic Effect Pattern (CORRECT ✅)
```typescript
/**
 * Run simulation eagerly, collecting all timesteps
 */
export const simulate = (
  model: Model
): Effect.Effect<Array<SimState>, SolverError, Solver> =>
  Effect.gen(function* () {
    const solver = yield* Solver
    const initialState = yield* initializeState(model)

    // eager iteration with effectful stepping
    return yield* Effect.loop(initialState, {
      while: (state) => state.time < model.timeConfig.end,
      step: (state) => state, // updated by body
      body: (state) =>
        Effect.gen(function* () {
          const nextState = yield* solver.step(model, state, model.timeConfig.step)
          return nextState
        })
    })
  })

/**
 * Stream variant for incremental consumption (UI/charts)
 */
export const simulateStream = (
  model: Model
): Stream.Stream<SimState, SolverError, Solver> =>
  Stream.fromEffect(simulate(model)).pipe(
    Stream.flatMap(Stream.fromIterable),
    Stream.tap((state) => Console.log(`t=${state.time}`)) // progress indicator
  )
```

**why better**:
- eager computation matches simulation semantics
- single Effect wrapper, clean type
- explicit about when to stream (for UI consumption)
- uses Effect.loop which is THE authentic pattern for stateful iteration
- can still provide streaming API via `Stream.fromIterable` if needed

---

## Alternative: Stateful Solver with Ref

if you want solver to manage its own state (adaptive step size):

```typescript
export const AdaptiveSolver = Layer.effect(
  Solver,
  Effect.gen(function* () {
    const dtRef = yield* Ref.make(0.1)

    return {
      step: (model, state, _dt) =>
        Effect.gen(function* () {
          const currentDt = yield* Ref.get(dtRef)

          // try full step
          const full = yield* stepWith(model, state, currentDt)

          // try two half-steps
          const half1 = yield* stepWith(model, state, currentDt / 2)
          const half2 = yield* stepWith(model, half1, currentDt / 2)

          // estimate error
          const error = estimateError(full, half2)

          if (error < tolerance) {
            // accept, increase dt
            yield* Ref.update(dtRef, dt => Math.min(dt * 1.5, dtMax))
            return half2
          } else {
            // reject, decrease dt, retry
            yield* Ref.update(dtRef, dt => Math.max(dt * 0.5, dtMin))
            return yield* this.step(model, state, currentDt / 2)
          }
        })
    }
  })
)
```

**pattern**: Ref in Layer initialization, updated during effectful step. this is how effect authors do stateful services.

---

## Recommendations

### 1. Replace Stream.unfold with Effect.loop
change simulation core to:
```typescript
const states = yield* Effect.loop(initialState, {
  while: (s) => s.time < endTime,
  step: (s) => s,
  body: (s) => solver.step(model, s, dt)
})
```

### 2. Provide streaming wrapper for UI
```typescript
export const simulateLive = (model: Model): Stream.Stream<SimState, SolverError, Solver> =>
  Stream.asyncEffect((emit) =>
    Effect.gen(function* () {
      const states = yield* simulate(model)
      for (const state of states) {
        yield* emit(Effect.succeed(Chunk.of(state)))
      }
    })
  )
```

### 3. Use Ref for solver state
adaptive dt, error estimation, retry counts - all belong in Ref inside solver Layer.

### 4. Don't mix Stream and Effect in unfold
unfold stepper is pure function `S => Option<[A, S]>`, not `S => Effect<...>`. if you need effects, use `Stream.asyncEffect` or `Effect.loop`.

### 5. Chunk for performance AFTER computation
```typescript
const states = yield* simulate(model) // eager array
const batched = Stream.fromIterable(states).pipe(
  Stream.rechunk(500), // batch for UI
  Stream.schedule(Schedule.spaced("100 millis")) // pace rendering
)
```

---

## Conclusion

your architecture uses streams because you saw them in effect docs and thought "reactive = streams". **wrong abstraction**.

simulation is **eager batch computation**, not **lazy pull-based evaluation**. correct pattern is `Effect.loop` for core, wrap in `Stream.fromIterable` if UI needs incremental consumption.

effect authors would:
1. use `Effect.loop` for time-stepping
2. collect states in array
3. provide streaming wrapper via `Stream.fromIterable` for UI
4. use `Ref` for solver state (adaptive dt)
5. chunk/pace streams for rendering, not computation

fix this before building features on wrong foundation. streams are powerful but you're not using them idiomatically.

---

## References

- `/Users/ryanhunter/git_forks/effect/packages/effect/src/Stream.ts` - stream constructors
- `/Users/ryanhunter/git_forks/effect/packages/effect/test/Stream/scanning.test.ts` - scan/mapAccum usage
- `/Users/ryanhunter/git_forks/effect/packages/effect/test/Effect/traversing.test.ts` - Effect.loop patterns
- Effect Docs: Stream.unfold (documentId: 10067)
- Effect Docs: Stream.iterate (documentId: 9918)
- Effect Docs: Effect.loop (documentId: 6059)
- Effect Docs: Ref state management (documentId: 10885)

---

**tl;dr**: your sim should be `Effect.loop`, not `Stream.unfold`. streams are for backpressure, you want eager iteration.
