# Effect System Dynamics - Clean Architecture

**What Effect's authors would build if they added system dynamics to the ecosystem.**

---

## Vision

A **pure, general, Effect-idiomatic system dynamics library** that:
- Models ANY continuous system (business, ecology, engineering, economics)
- Composes like Effect services (layered, swappable, testable)
- Returns Effect types for all operations (no exceptions, resource-safe)
- Integrates seamlessly with Effect ecosystem (Graph, Schema, Stream, Layer)
- Is publishable to npm with zero domain-specific assumptions

---

## Core Principles

1. **Pure Effect** - zero mutable state, all operations return Effect
2. **Composable** - stocks/flows/solvers compose via Effect patterns
3. **General** - no SaaS/marketing/sales assumptions baked in
4. **Schema-First** - @effect/schema for all data structures
5. **Streaming** - simulation results as Effect.Stream
6. **Layered** - solvers as swappable Layer services
7. **Graph-Native** - Effect.Graph for equation dependencies

---

## Package Structure (Modular, Decoupled)

```
@org/effect-system-dynamics        (core library - PURE)
  ├─ stocks, flows, variables
  ├─ equation evaluator
  ├─ euler, rk4, adaptive solvers
  ├─ units with dimensional analysis
  ├─ Effect.Graph integration
  ├─ Stream-based simulation
  └─ zero coupling to anything

@org/effect-system-dynamics-scenarios   (scenario branching/comparison)
  ├─ scenario management
  ├─ sensitivity analysis
  ├─ parameter optimization
  └─ depends on: core

@org/effect-system-dynamics-persistence (repos, optional)
  ├─ generic ModelRepository interface
  ├─ spanner implementation (example)
  └─ depends on: core, scenarios

@org/effect-system-dynamics-ui         (visualization, optional)
  ├─ xyflow components
  ├─ time series charts
  ├─ scenario comparison views
  └─ depends on: core, scenarios

lever (consumer, not part of effect-system-dynamics)
  ├─ domain templates (SaaS, marketing, etc)
  ├─ LLM model generation (effect/ai)
  ├─ OGP integration
  ├─ team workspaces
  └─ depends on: all above packages
```

---

## 1. Core Library (@org/effect-system-dynamics)

### 1.1 Fundamental Abstractions

```typescript
/**
 * Stock - accumulator with initial value
 */
export class Stock extends Schema.Class<Stock>("Stock")({
  id: StockId,
  name: Schema.String,
  initialValue: Schema.Number,
  units: Schema.optional(UnitType),
  description: Schema.optional(Schema.String)
}) {}

/**
 * Flow - rate of change between stocks
 */
export class Flow extends Schema.Class<Flow>("Flow")({
  id: FlowId,
  name: Schema.String,
  from: Schema.optional(StockId),      // undefined = source (cloud)
  to: Schema.optional(StockId),        // undefined = sink (cloud)
  rateEquation: Equation,
  units: Schema.optional(UnitType)
}) {}

/**
 * Variable - computed auxiliary or constant
 */
export class Variable extends Schema.Class<Variable>("Variable")({
  id: VariableId,
  name: Schema.String,
  equation: Equation,
  type: Schema.Literal("auxiliary", "constant"),
  value: Schema.optional(Schema.Number)  // for constants
}) {}

/**
 * Equation - formula with references to other primitives
 *
 * Examples:
 * - "birth_rate * population"
 * - "IF(time < 10, rate_A, rate_B)"  // phase transition
 * - "revenue - expenses"
 */
export class Equation extends Schema.Class<Equation>("Equation")({
  expression: Schema.String,
  references: Schema.Array(Schema.String), // other primitive names
  validated: Schema.Boolean
}) {}

/**
 * Model - container for complete system
 */
export class Model extends Schema.Class<Model>("Model")({
  id: ModelId,
  name: Schema.String,
  stocks: Schema.Array(Stock),
  flows: Schema.Array(Flow),
  variables: Schema.Array(Variable),
  timeConfig: TimeConfig,

  // Optional: exogenous inputs for discrete events
  exogenousInputs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        time: Schema.Number,
        variable: Schema.String,
        value: Schema.Number
      })
    )
  )
}) {}

export class TimeConfig extends Schema.Class<TimeConfig>("TimeConfig")({
  start: Schema.Number,
  end: Schema.Number,
  step: Schema.Number
}) {}
```

### 1.2 Units System (from scottfr patterns)

```typescript
/**
 * Unit - dimensional analysis for correctness
 */
export class Unit extends Schema.Class<Unit>("Unit")({
  name: Schema.String,
  dimensions: Schema.Struct({
    mass: Schema.Number,
    length: Schema.Number,
    time: Schema.Number,
    current: Schema.Number,
    temperature: Schema.Number,
    amount: Schema.Number,
    luminosity: Schema.Number
  }),
  toBase: Schema.Number  // conversion factor
}) {}

/**
 * UnitManager - service for unit conversion/validation
 */
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

export const UnitManagerLive: Layer.Layer<UnitManager> = ...
```

### 1.3 Equation Evaluator (Effect.Graph Integration)

```typescript
/**
 * EquationEvaluator - evaluates formulas with dependency ordering
 */
export interface EquationEvaluator {
  readonly buildGraph: (
    model: Model
  ) => Effect.Effect<Graph.Graph<string, unknown>, EquationError>

  readonly topologicalOrder: (
    graph: Graph.Graph<string, unknown>
  ) => Effect.Effect<Array<string>, EquationError>

  readonly evaluate: (
    equation: Equation,
    context: Map<string, number>,
    time: number
  ) => Effect.Effect<number, EquationError>

  readonly evaluateAll: (
    model: Model,
    state: SimState
  ) => Effect.Effect<Map<string, number>, EquationError>
}

export const EquationEvaluatorLive: Layer.Layer<EquationEvaluator> = ...
```

**Key insight:** Use Effect.Graph.topologicalSort to determine evaluation order, detecting cycles with Effect.Graph.isAcyclic.

### 1.4 Solver Interface

```typescript
/**
 * Solver - numerical integration service
 */
export interface Solver {
  readonly step: (
    model: Model,
    state: SimState,
    dt: number
  ) => Effect.Effect<SimState, SolverError>
}

export const Solver = Context.GenericTag<Solver>("@org/effect-system-dynamics/Solver")

/**
 * SimState - point-in-time snapshot
 */
export class SimState extends Schema.Class<SimState>("SimState")({
  time: Schema.Number,
  stocks: Schema.Record({ key: Schema.String, value: Schema.Number }),
  variables: Schema.Record({ key: Schema.String, value: Schema.Number })
}) {}
```

### 1.5 Solver Implementations

#### Euler (Greedy - <50ms)

```typescript
export const EulerSolver = Layer.succeed(
  Solver,
  Solver.of({
    step: (model, state, dt) =>
      Effect.gen(function* () {
        const evaluator = yield* EquationEvaluator

        // Evaluate all flows at current state
        const rates = yield* evaluator.evaluateAll(model, state)

        // Update stocks: stock[t+dt] = stock[t] + rate[t] * dt
        const nextStocks = Object.fromEntries(
          model.stocks.map(stock => {
            const rate = rates.get(`flow_to_${stock.id}`) ?? 0
            return [stock.id, state.stocks[stock.id] + rate * dt]
          })
        )

        // Recompute variables at new state
        const nextState = new SimState({
          time: state.time + dt,
          stocks: nextStocks,
          variables: {}
        })
        const nextVariables = yield* evaluator.evaluateAll(model, nextState)

        return new SimState({
          time: state.time + dt,
          stocks: nextStocks,
          variables: Object.fromEntries(nextVariables)
        })
      })
  })
)
```

#### RK4 (Local Search - <500ms)

```typescript
export const RK4Solver = Layer.effect(
  Solver,
  Effect.gen(function* () {
    const evaluator = yield* EquationEvaluator

    return Solver.of({
      step: (model, state, dt) =>
        Effect.gen(function* () {
          // k1 = f(t, y)
          const k1 = yield* computeDerivatives(model, state, evaluator)

          // k2 = f(t + dt/2, y + k1*dt/2)
          const state2 = advanceState(state, k1, dt / 2)
          const k2 = yield* computeDerivatives(model, state2, evaluator)

          // k3 = f(t + dt/2, y + k2*dt/2)
          const state3 = advanceState(state, k2, dt / 2)
          const k3 = yield* computeDerivatives(model, state3, evaluator)

          // k4 = f(t + dt, y + k3*dt)
          const state4 = advanceState(state, k3, dt)
          const k4 = yield* computeDerivatives(model, state4, evaluator)

          // y[t+dt] = y[t] + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
          return combineRK4Steps(state, [k1, k2, k3, k4], dt)
        })
    })
  })
)
```

#### Adaptive (Global Optimization - 1-5s)

```typescript
export const AdaptiveSolver = Layer.effect(
  Solver,
  Effect.gen(function* () {
    const tolerance = 1e-6
    const dtMin = 0.001
    const dtMax = 1.0

    const dtRef = yield* Ref.make(0.1)

    return Solver.of({
      step: (model, state, dt) =>
        Effect.gen(function* () {
          const currentDt = yield* Ref.get(dtRef)

          // Try full step
          const full = yield* stepWith(model, state, currentDt)

          // Try two half-steps
          const half1 = yield* stepWith(model, state, currentDt / 2)
          const half2 = yield* stepWith(model, half1, currentDt / 2)

          // Estimate error
          const error = estimateError(full, half2)

          if (error < tolerance) {
            // Accept, maybe increase dt
            yield* Ref.update(dtRef, dt => Math.min(dt * 1.5, dtMax))
            return half2  // more accurate
          } else {
            // Reject, decrease dt, retry
            yield* Ref.update(dtRef, dt => Math.max(dt * 0.5, dtMin))
            return yield* step(model, state, currentDt / 2)
          }
        })
    })
  })
)
```

### 1.6 Simulation Engine

```typescript
/**
 * simulate - stream-based time-stepping
 */
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

/**
 * SimulationService - high-level simulation operations
 */
export interface SimulationService {
  readonly run: (
    model: Model
  ) => Effect.Effect<SimResult, SimulationError>

  readonly runLive: (
    model: Model
  ) => Stream.Stream<SimState, SimulationError>
}

export class SimResult extends Schema.Class<SimResult>("SimResult")({
  modelId: ModelId,
  states: Schema.Array(SimState),
  metadata: Schema.Struct({
    solver: Schema.String,
    steps: Schema.Number,
    duration: Schema.Number
  })
}) {}

export const SimulationServiceLive = Layer.effect(
  SimulationService,
  Effect.gen(function* () {
    return {
      run: (model) =>
        Effect.gen(function* () {
          const start = Date.now()
          const stream = yield* simulate(model).pipe(
            Effect.provide(EulerSolver)  // default solver
          )
          const states = yield* Stream.runCollect(stream)

          return new SimResult({
            modelId: model.id,
            states: Chunk.toArray(states),
            metadata: {
              solver: "euler",
              steps: states.length,
              duration: Date.now() - start
            }
          })
        }),

      runLive: (model) =>
        Stream.unwrap(
          simulate(model).pipe(Effect.provide(EulerSolver))
        )
    }
  })
)
```

---

## 2. Scenario Management (@org/effect-system-dynamics-scenarios)

### 2.1 Scenario Branching

```typescript
/**
 * Scenario - model reference + parameter overrides + label
 */
export class Scenario extends Schema.Class<Scenario>("Scenario")({
  id: ScenarioId,
  name: Schema.String,
  baseModelId: ModelId,
  overrides: Schema.Record({
    key: Schema.String,  // variable/stock name
    value: Schema.Number
  }),
  description: Schema.optional(Schema.String)
}) {}

/**
 * ScenarioService - branching and comparison
 */
export interface ScenarioService {
  readonly branch: (
    baseModel: Model,
    name: string,
    overrides: Record<string, number>
  ) => Effect.Effect<Scenario, ScenarioError>

  readonly compare: (
    scenarios: Array<Scenario>
  ) => Effect.Effect<ScenarioComparison, ScenarioError>
}
```

### 2.2 Sensitivity Analysis

```typescript
/**
 * SensitivityService - identify leverage points
 */
export interface SensitivityService {
  readonly analyze: (
    model: Model,
    targetVariable: string,
    parameters: Array<string>,
    variationPercent: number
  ) => Effect.Effect<Array<SensitivityResult>, SensitivityError>
}

export class SensitivityResult extends Schema.Class<SensitivityResult>("SensitivityResult")({
  parameter: Schema.String,
  impact: Schema.Number,      // % change in target
  direction: Schema.Literal("positive", "negative"),
  confidence: Schema.Number
}) {}
```

### 2.3 Parameter Optimization

```typescript
/**
 * OptimizerService - find params that maximize/minimize target
 */
export interface OptimizerService {
  readonly optimize: (
    model: Model,
    objective: Objective,
    constraints: Array<Constraint>
  ) => Effect.Effect<OptimizationResult, OptimizationError>
}

export class Objective extends Schema.Class<Objective>("Objective")({
  target: Schema.String,      // variable to optimize
  direction: Schema.Literal("maximize", "minimize"),
  atTime: Schema.Number       // time to evaluate
}) {}

export class Constraint extends Schema.Class<Constraint>("Constraint")({
  parameter: Schema.String,
  min: Schema.Number,
  max: Schema.Number
}) {}

**current status (2025-10-30):**
- Scenario branching, comparison, sensitivity analysis, and grid-search optimisation live in `Scenarios.ts` with corresponding Effect services.
- Sensitivity currently runs simple ±% perturbations per parameter; optimiser performs uniform grid search (configurable steps) while maintaining explicit unit enforcement.
- Future improvements (genetic search, persistence) remain open.
```

**Implementation Options:**
- v1: Grid search (simple, good enough)
- v2: Genetic algorithm (if demand)
- v3: Integration with external optimizers (MiniZinc, scipy)

---

## 3. Phase Transitions & Discrete Events

### 3.1 Via Conditional Equations (v1 - simple)

```typescript
// Phase transition: different dynamics based on state
const growth_rate = new Variable({
  name: "growth_rate",
  equation: new Equation({
    expression: "IF(revenue < 1000000, 0.5, 0.1)",
    references: ["revenue"]
  })
})

// Discrete event: external shock at specific time
const ad_spend = new Variable({
  name: "ad_spend",
  equation: new Equation({
    expression: "IF(time < 10, 50000, 100000)",
    references: ["time"]
  })
})
```

### 3.2 Via Exogenous Inputs (v1 - simple)

```typescript
const model = new Model({
  // ...other fields...
  exogenousInputs: [
    { time: 10, variable: "product_launched", value: 1 },
    { time: 20, variable: "price_per_unit", value: 150 },  // was 100
    { time: 30, variable: "competitor_entered", value: 1 }
  ]
})
```

### 3.3 Via Effect.Machine (v2 - if needed)

**Use case:** Interactive simulation with dynamic parameter updates

```typescript
// SimulationActor - actor that runs simulation and accepts messages
const SimulationActor = Machine.make({
  initialize: (model: Model) =>
    Effect.gen(function* () {
      const state = yield* initializeState(model)
      return procedures.make<Requests, SimState>()(
        procedures.make()("step", stepHandler),
        procedures.make()("adjustParameter", adjustHandler),
        procedures.make()("getState", getStateHandler)
      )
    })
})

// Send messages to adjust params mid-simulation
yield* actor.send(new AdjustParameter({ name: "ad_spend", value: 75000 }))
```

**Defer to v2:** Only if users need interactive/distributed simulation.

---

## 4. Lever Integration (Separate Layer)

### 4.1 What Lever Adds (Not Part of Core)

- **Domain templates** - pre-built SaaS/marketing/sales models
- **LLM generation** - natural language → model (via effect/ai)
- **Persistence** - spanner repos for models/scenarios
- **UI** - xyflow visualization, time series charts
- **OGP integration** - dynamics → actions
- **Team workspaces** - collaboration, versioning
- **Model marketplace** - 150 templates users can clone

### 4.2 Integration Pattern

```
lever/packages/server/
  └─ domain/dynamics/
      ├─ dynamics-rpc-live.ts         (RPC handlers)
      ├─ dynamics-analysis-service.ts  (leverage → actions)
      └─ model-templates/             (SaaS, marketing, etc)

lever/packages/client/
  └─ features/dynamics/
      ├─ ModelEditor.tsx              (xyflow model building)
      ├─ ScenarioComparison.tsx       (overlay charts)
      └─ LeverageAnalysis.tsx         (sensitivity heatmap)
```

**Key:** Lever depends on `@org/effect-system-dynamics-*`, not the other way around.

---

## 5. Implementation Roadmap

### Phase 1 (Weeks 1-2): Core Library
- Stock, Flow, Variable, Model schemas ✓
- Equation evaluator with Effect.Graph ✓
- Euler solver ✓
- Units system (from scottfr patterns) ✓
- Stream-based simulation ✓
- **Deliverable:** npm package, pure Effect, zero coupling

### Phase 2 (Week 3): Advanced Solvers
- RK4 solver ✓
- Adaptive solver with error control ✓
- Solver benchmarking ✓
- **Deliverable:** swap solvers via Layer

### Phase 3 (Week 4): Scenarios
- Scenario branching ✓
- Sensitivity analysis ✓
- Parameter optimization (grid search) ✓
- **Deliverable:** compare 10 scenarios, find leverage points

### Phase 4 (Week 5): Persistence
- ModelRepository interface ✓
- Spanner implementation (example) ✓
- Scenario storage ✓
- **Deliverable:** persist models/results

### Phase 5 (Weeks 6-7): UI
- XYFlow model editor ✓
- Time series charts ✓
- Scenario comparison views ✓
- **Deliverable:** visual modeling + results

### Phase 6 (Week 8): Lever Integration
- LLM model generation (effect/ai) ✓
- Sensitivity → OGP actions ✓
- Model templates ✓
- **Deliverable:** end-to-end: natural language → simulation → actions

**Total: 8 weeks to production**

---

## 6. Success Criteria

### Technical
- ✅ All tests passing (unit, integration, e2e)
- ✅ Typecheck clean with strict mode
- ✅ Zero Effect anti-patterns
- ✅ < 10ms p95 for simulation step
- ✅ Schema-validated at every boundary

### Product
- ✅ Demo: business model → simulate → leverage points
- ✅ Publishable to npm with clean README
- ✅ Zero domain assumptions in core

### Architectural
- ✅ Solvers swappable via Layer
- ✅ Equations use Effect.Graph for ordering
- ✅ Units validated with dimensional analysis
- ✅ Streams for reactive simulation
- ✅ Lever is consumer, not coupled

---

## 7. Open Questions

1. **Equation DSL:** Custom parser (ANTLR) or leverage existing (math.js, expr-eval)?
   - **Lean toward:** expr-eval (simpler), add custom functions if needed

2. **Effect.Machine:** Use for concurrent scenarios or defer to v2?
   - **Lean toward:** defer - not needed for basic scenarios

3. **Optimization depth:** Grid search only or add genetic algorithm?
   - **Lean toward:** grid search v1, genetic v2 if demand

4. **Unit system scope:** Full dimensional analysis or basic validation?
   - **Lean toward:** full analysis (prevents bugs), cloned from scottfr

5. **Graph library:** Effect.Graph or custom topological sort?
   - **Lean toward:** Effect.Graph (industrial strength, zero maintenance)

---

## Conclusion

This architecture gives you:
- **Pure Effect-idiomatic core** publishable to npm
- **Modular layers** (scenarios, persistence, UI) as separate packages
- **Lever as consumer** that adds domain templates + LLM + OGP
- **8-week roadmap** to production

The core is maximally general - models ANY continuous system with stocks/flows/feedback loops. Domain-specific stuff (SaaS templates, natural language interface) lives in lever, not core.

Ready to start Phase 1 (core library) or iterate on architecture first?
