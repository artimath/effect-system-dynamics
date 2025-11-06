# Effect System Dynamics Architecture

**Version:** 0.1.0 (Draft)
**Date:** 2025-10-30
**Status:** Design Phase

---

## Vision

Build a **functionally composable, Effect-idiomatic system dynamics library** that:
- Makes stock-flow modeling feel native to TypeScript developers
- Integrates seamlessly with lever's graph storage and XYFlow visualization
- Exposes AI-powered analysis tools for scenario exploration
- Enables OGP to reason about system dynamics and target leverage points

**Core Principle:** System dynamics should compose like Effect services—pure, typed, swappable, and testable.

---

## 1. Core Abstractions

### 1.1 Model Elements (Schema-Based)

```typescript
// Stock: accumulator with initial value
export class Stock extends Schema.Class<Stock>("Stock")({
  id: StockId,
  name: Schema.String,
  initialValue: Schema.Number,
  units: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
}) {}

// Flow: rate of change connecting stocks
export class Flow extends Schema.Class<Flow>("Flow")({
  id: FlowId,
  name: Schema.String,
  from: Schema.optional(StockId), // undefined = cloud (source)
  to: Schema.optional(StockId),   // undefined = cloud (sink)
  rateFormula: Schema.String,     // e.g., "birth_rate * population"
  units: Schema.optional(Schema.String)
}) {}

// Variable: computed value (auxiliary or constant)
export class Variable extends Schema.Class<Variable>("Variable")({
  id: VariableId,
  name: Schema.String,
  formula: Schema.String,         // e.g., "population / capacity"
  type: Schema.Literal("auxiliary", "constant"),
  value: Schema.optional(Schema.Number) // for constants
}) {}

// Model: container for stocks, flows, variables
export class Model extends Schema.Class<Model>("Model")({
  id: ModelId,
  name: Schema.String,
  stocks: Schema.Array(Stock),
  flows: Schema.Array(Flow),
  variables: Schema.Array(Variable),
  timeConfig: TimeConfig
}) {}

export class TimeConfig extends Schema.Class<TimeConfig>("TimeConfig")({
  start: Schema.Number,
  end: Schema.Number,
  step: Schema.Number
}) {}
```

### 1.2 Simulation State

```typescript
// SimState: point-in-time snapshot
export class SimState extends Schema.Class<SimState>("SimState")({
  time: Schema.Number,
  stocks: Schema.Record({ key: StockId, value: Schema.Number }),
  variables: Schema.Record({ key: VariableId, value: Schema.Number })
}) {}

// SimResult: full time series
export class SimResult extends Schema.Class<SimResult>("SimResult")({
  modelId: ModelId,
  states: Schema.Array(SimState),
  metadata: Schema.Struct({
    solver: Schema.String,
    steps: Schema.Number,
    duration: Schema.Number // ms
  })
}) {}
```

---

## 2. Solver Service Layer

### 2.1 Solver Interface

```typescript
export interface Solver {
  readonly step: (
    model: Model,
    state: SimState,
    dt: number
  ) => Effect.Effect<SimState, SolverError>
}

export const Solver = Context.GenericTag<Solver>("@org/effect-system-dynamics/Solver")
```

### 2.2 Solver Implementations

#### Euler (Greedy - <50ms)

```typescript
export const EulerSolver = Layer.succeed(
  Solver,
  Solver.of({
    step: (model, state, dt) =>
      Effect.gen(function* () {
        // 1. Evaluate all flows using current state
        const rates = yield* evaluateFlows(model.flows, state)

        // 2. Update stocks: stock[t+dt] = stock[t] + rate[t] * dt
        const nextStocks = Object.fromEntries(
          model.stocks.map(stock => [
            stock.id,
            state.stocks[stock.id] + rates[stock.id] * dt
          ])
        )

        // 3. Recompute variables at new time
        const nextVariables = yield* evaluateVariables(model.variables, nextStocks)

        return new SimState({
          time: state.time + dt,
          stocks: nextStocks,
          variables: nextVariables
        })
      })
  })
)
```

#### RK4 (Local Search - <500ms)

```typescript
export const RK4Solver = Layer.succeed(
  Solver,
  Solver.of({
    step: (model, state, dt) =>
      Effect.gen(function* () {
        // k1 = f(t, y)
        const k1 = yield* evaluateDerivatives(model, state)

        // k2 = f(t + dt/2, y + k1*dt/2)
        const k2 = yield* evaluateDerivatives(
          model,
          advanceState(state, k1, dt / 2)
        )

        // k3 = f(t + dt/2, y + k2*dt/2)
        const k3 = yield* evaluateDerivatives(
          model,
          advanceState(state, k2, dt / 2)
        )

        // k4 = f(t + dt, y + k3*dt)
        const k4 = yield* evaluateDerivatives(
          model,
          advanceState(state, k3, dt)
        )

        // y[t+dt] = y[t] + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
        return combineSteps(state, [k1, k2, k3, k4], dt)
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

    const ref = yield* Ref.make({ dt: 0.1, errorHistory: [] })

    return Solver.of({
      step: (model, state, dt) =>
        Effect.gen(function* () {
          const { dt: currentDt } = yield* Ref.get(ref)

          // Try step with current dt
          const full = yield* stepWith(model, state, currentDt)

          // Try two half-steps
          const half1 = yield* stepWith(model, state, currentDt / 2)
          const half2 = yield* stepWith(model, half1, currentDt / 2)

          // Estimate error
          const error = estimateError(full, half2)

          if (error < tolerance) {
            // Accept step, maybe increase dt
            yield* Ref.update(ref, old => ({
              dt: Math.min(old.dt * 1.5, dtMax),
              errorHistory: [...old.errorHistory.slice(-10), error]
            }))
            return half2 // use more accurate result
          } else {
            // Reject step, decrease dt, retry
            yield* Ref.update(ref, old => ({
              dt: Math.max(old.dt * 0.5, dtMin),
              errorHistory: old.errorHistory
            }))
            yield* step(model, state, currentDt / 2) // recursive retry
          }
        })
    })
  })
)
```

---

## 3. Simulation Engine

### 3.1 Stream-Based Time-Stepping

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

### 3.2 Simulation Service

```typescript
export interface SimulationService {
  readonly run: (
    modelId: ModelId,
    solver?: "euler" | "rk4" | "adaptive"
  ) => Effect.Effect<SimResult, SimulationError>

  readonly runLive: (
    modelId: ModelId
  ) => Stream.Stream<SimState, SimulationError>
}

export const SimulationServiceLive = Layer.effect(
  SimulationService,
  Effect.gen(function* () {
    const modelRepo = yield* ModelRepository

    return {
      run: (modelId, solver = "euler") =>
        Effect.gen(function* () {
          const model = yield* modelRepo.get(modelId)
          const solverLayer = selectSolver(solver)

          const stateStream = yield* simulate(model).pipe(
            Effect.provide(solverLayer)
          )

          const states = yield* Stream.runCollect(stateStream)

          return new SimResult({
            modelId,
            states: Chunk.toArray(states),
            metadata: { solver, steps: states.length, duration: 0 }
          })
        }),

      runLive: (modelId) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const model = yield* modelRepo.get(modelId)
            return yield* simulate(model).pipe(
              Effect.provide(EulerSolver)
            )
          })
        )
    }
  })
)
```

---

## 4. Graph Persistence (Spanner Integration)

### 4.1 Node Schemas

```typescript
// StockNode - maps to GraphNode with label "SDStock"
export class StockNode extends Schema.Class<StockNode>("StockNode")({
  id: NodeId,
  label: Schema.Literal("SDStock"),
  properties: Schema.Struct({
    name: Schema.String,
    initial_value: Schema.Number,
    units: Schema.optional(Schema.String),
    visual_state: VisualState
  })
}).pipe(
  Schema.transform(
    // decode: snake_case → camelCase
    Schema.Struct({
      id: NodeId,
      name: Schema.String,
      initialValue: Schema.Number,
      units: Schema.optional(Schema.String),
      visualState: VisualState
    }),
    {
      decode: (node) => ({
        id: node.id,
        name: node.properties.name,
        initialValue: node.properties.initial_value,
        units: node.properties.units,
        visualState: node.properties.visual_state
      }),
      encode: (stock) => ({
        id: stock.id,
        label: "SDStock" as const,
        properties: {
          name: stock.name,
          initial_value: stock.initialValue,
          units: stock.units,
          visual_state: stock.visualState
        }
      })
    }
  )
)
```

### 4.2 Edge Schemas

```typescript
// FlowEdge - maps to GraphEdge with label "SD_FLOW"
export class FlowEdge extends Schema.Class<FlowEdge>("FlowEdge")({
  id: EdgeId,
  label: Schema.Literal("SD_FLOW"),
  source: NodeId,
  target: NodeId,
  properties: Schema.Struct({
    name: Schema.String,
    rate_formula: Schema.String,
    units: Schema.optional(Schema.String)
  })
})

// LinkEdge - information dependency (no material flow)
export class LinkEdge extends Schema.Class<LinkEdge>("LinkEdge")({
  id: EdgeId,
  label: Schema.Literal("SD_LINK"),
  source: NodeId,
  target: NodeId,
  properties: Schema.Struct({
    polarity: Schema.Literal("+", "-") // reinforcing or balancing
  })
})
```

### 4.3 Repository Pattern

```typescript
export const makeStockRepo = SpannerGraphClient.toRepo({
  Label: "SDStock" as const,
  Schema: StockNode,

  makeId: () => Effect.sync(() => generateUUID()),

  create: (client) => (payload) =>
    Effect.gen(function* () {
      const id = yield* generateUUID()

      yield* client`
        INSERT INTO GraphNode (id, label, properties)
        VALUES (${id}, 'SDStock', ${client.asJSONStatement({
          name: payload.name,
          initial_value: payload.initialValue,
          units: payload.units,
          visual_state: payload.visualState
        })})
      `.pipe(Effect.orDie)

      return yield* StockNode.decode({ id, ...payload })
    }),

  list: (client) => () =>
    client.gql<{ element: { properties: unknown } }>`
      MATCH (n:SDStock)
      RETURN SAFE_TO_JSON(n) AS element
    `.pipe(
      Effect.flatMap(rows =>
        Effect.forEach(rows, row =>
          StockNode.decode(row.element.properties)
        )
      )
    )
})
```

---

## 5. XYFlow Visualization

### 5.1 Custom Node Components

```typescript
// StockNode.tsx
export const StockNode: React.FC<NodeProps<StockNodeData>> = ({ data, selected }) => {
  const updateStock = useAtomSet(updateStockMutation)
  const simState = useAtomValue(currentSimStateAtom)

  const currentValue = simState.stocks[data.id] ?? data.initialValue

  return (
    <BaseNode selected={selected} className="stock-node">
      <Handle type="target" position={Position.Left} id="inflow" />

      <div className="stock-body">
        <div className="stock-name">{data.name}</div>
        <div className="stock-value">{currentValue.toFixed(2)}</div>
        <div className="stock-units">{data.units}</div>
      </div>

      <Handle type="source" position={Position.Right} id="outflow" />
    </BaseNode>
  )
}

// FlowEdge.tsx
export const FlowEdge: React.FC<EdgeProps<FlowEdgeData>> = ({ data, ...props }) => {
  const simState = useAtomValue(currentSimStateAtom)
  const flowRate = evaluateFormula(data.rateFormula, simState)

  return (
    <BaseEdge {...props}>
      <EdgeLabelRenderer>
        <div className="flow-label">
          <div className="valve-icon">⊳</div>
          <div className="flow-rate">{flowRate.toFixed(2)}</div>
        </div>
      </EdgeLabelRenderer>
    </BaseEdge>
  )
}
```

### 5.2 Effect-Atom Integration

```typescript
// Model atoms (remote)
export const sdModelsAtom = runtime.atom(() =>
  Effect.gen(function* () {
    const client = yield* ApiClient
    return yield* client.http.systemDynamics.listModels()
  })
)

// XYFlow state (managed)
export const xyflowNodesAtom = Atom.writable(
  (get) => {
    const models = get(sdModelsAtom)
    return Result.match(models, {
      onSuccess: (models) => modelsToXYFlowNodes(models),
      onWaiting: () => [],
      onFailure: () => []
    })
  },
  (get, set, update: NodesUpdate) => {
    // optimistic update with rollback
    const prev = get(xyflowNodesAtom)
    const next = applyNodesUpdate(prev, update)
    set(xyflowNodesAtom, next)

    return runtime.run(
      Effect.gen(function* () {
        yield* persistNodesUpdate(update)
        yield* invalidate(sdModelsAtom)
      })
    ).pipe(
      Effect.catchAll(() => {
        set(xyflowNodesAtom, prev) // rollback on error
        return Effect.unit
      })
    )
  }
)

// Simulation state (real-time)
export const currentSimStateAtom = runtime.atom(() =>
  Effect.gen(function* () {
    const simService = yield* SimulationService
    const activeModelId = yield* Ref.get(activeModelIdRef)

    return yield* simService.runLive(activeModelId).pipe(
      Stream.runLast,
      Effect.map(Option.getOrElse(() => initialState))
    )
  })
)
```

---

## 6. AI Integration (Effect.ai Tools)

### 6.1 Tool Specifications

```typescript
export const GenerateModelTool = Tool.make({
  name: "generate_sd_model",
  description: "Generate stock-flow model from natural language description",
  parameters: Schema.Struct({
    description: Schema.String.pipe(
      Schema.description("Natural language description of system dynamics")
    ),
    domain: Schema.optional(Schema.String)
  }),
  execute: (params) =>
    Effect.gen(function* () {
      const llm = yield* LanguageModel
      const prompt = yield* buildGenerationPrompt(params.description)

      const response = yield* llm.generate(prompt, {
        schema: ModelGenerationSchema
      })

      const modelRepo = yield* ModelRepository
      return yield* modelRepo.create(response.model)
    })
})

export const SimulateTool = Tool.make({
  name: "simulate",
  description: "Run system dynamics simulation",
  parameters: Schema.Struct({
    modelId: ModelId,
    solver: Schema.optional(Schema.Literal("euler", "rk4", "adaptive")),
    overrides: Schema.optional(Schema.Record({
      key: Schema.String,
      value: Schema.Number
    }))
  }),
  execute: (params) =>
    Effect.gen(function* () {
      const simService = yield* SimulationService
      return yield* simService.run(params.modelId, params.solver)
    })
})

export const SensitivityAnalysisTool = Tool.make({
  name: "sensitivity_analysis",
  description: "Vary parameters and rank by impact on outcome",
  parameters: Schema.Struct({
    modelId: ModelId,
    targetVariable: Schema.String,
    parameters: Schema.Array(Schema.String),
    variation: Schema.Number.pipe(Schema.description("Percentage to vary (default 10%)"))
  }),
  execute: (params) =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        params.parameters,
        (param) =>
          Effect.gen(function* () {
            const base = yield* runSimulation(params.modelId, {})
            const varied = yield* runSimulation(params.modelId, {
              [param]: base[param] * (1 + params.variation / 100)
            })

            return {
              parameter: param,
              impact: Math.abs(varied[params.targetVariable] - base[params.targetVariable])
            }
          }),
        { concurrency: 10 }
      )

      return results.sort((a, b) => b.impact - a.impact)
    })
})
```

### 6.2 Agentic Workflow Example

```typescript
export const exploreScenarioWorkflow = (
  description: string
): Effect.Effect<ScenarioReport, WorkflowError, LanguageModel> =>
  Effect.gen(function* () {
    const llm = yield* LanguageModel

    // Step 1: Generate model
    const model = yield* GenerateModelTool.execute({ description })

    // Step 2: Run baseline simulation
    const baseline = yield* SimulateTool.execute({
      modelId: model.id,
      solver: "rk4"
    })

    // Step 3: Sensitivity analysis
    const sensitivities = yield* SensitivityAnalysisTool.execute({
      modelId: model.id,
      targetVariable: "outcome",
      parameters: model.variables.map(v => v.name),
      variation: 10
    })

    // Step 4: LLM explains leverage points
    const explanation = yield* llm.generate(
      buildExplanationPrompt(baseline, sensitivities),
      { schema: ExplanationSchema }
    )

    return {
      model,
      baseline,
      sensitivities,
      explanation,
      recommendedActions: generateActions(sensitivities)
    }
  })
```

---

## 7. OGP Integration

### 7.1 Dynamics → Actions

System dynamics identifies **leverage points** (high-impact parameters). OGP translates these into **Actions** targeting those parameters.

```typescript
export const dynamicsToActions = (
  sensitivities: SensitivityResult[],
  model: Model
): Effect.Effect<Action[], ConversionError> =>
  Effect.gen(function* () {
    const topLeveragePoints = sensitivities.slice(0, 3) // top 3 parameters

    return yield* Effect.forEach(topLeveragePoints, (sensitivity) =>
      Effect.gen(function* () {
        const param = model.variables.find(v => v.name === sensitivity.parameter)

        return new Action({
          id: yield* generateUUID(),
          title: `Adjust ${param.name}`,
          description: `Leverage point with ${sensitivity.impact}% impact on outcome`,
          estimatedEffort: 1, // hours
          priority: sensitivity.impact > 50 ? "high" : "medium"
        })
      })
    )
  })
```

### 7.2 OGP Scheduler Integration

```typescript
export const scheduleAnalysis = (
  outcomeId: OutcomeId
): Effect.Effect<void, ScheduleError, SimulationService | OutcomeRepository> =>
  Effect.gen(function* () {
    const outcome = yield* OutcomeRepository.get(outcomeId)
    const model = yield* extractModelFromOutcome(outcome)

    // Run dynamics simulation
    const simResult = yield* SimulationService.run(model.id, "rk4")

    // Identify critical timeline
    const criticalTime = findCriticalPoint(simResult)

    // Update OGP plan timing based on dynamics
    yield* OutcomeRepository.update(outcomeId, {
      timing: {
        type: "time_bound",
        deadline: criticalTime,
        reasoning: "System dynamics analysis shows critical point"
      }
    })
  })
```

---

## 8. Implementation Phases

### Phase 1: Core (MVP)
**Timeline:** 2 weeks
**Deliverables:**
- Stock, Flow, Variable, Model schemas ✓
- Euler solver ✓
- simulate() function with Stream.unfold ✓
- Basic tests with simple population model ✓

### Phase 2: Persistence
**Timeline:** 1 week
**Deliverables:**
- Spanner node/edge schemas ✓
- ModelRepository with CRUD operations ✓
- Migration scripts ✓
- Integration tests ✓

### Phase 3: Visualization
**Timeline:** 2 weeks
**Deliverables:**
- StockNode, VariableNode, ParameterNode components ✓
- FlowEdge with valve rendering ✓
- Real-time simulation overlay ✓
- Effect-Atom integration ✓

### Phase 4: Advanced Solvers
**Timeline:** 1 week
**Deliverables:**
- RK4 solver ✓
- Adaptive solver with error control ✓
- Solver benchmarking ✓
- Layer-based composition ✓

### Phase 5: AI Tools
**Timeline:** 2 weeks
**Deliverables:**
- GenerateModel, Simulate, SensitivityAnalysis tools ✓
- MCP server integration ✓
- Agentic workflow examples ✓
- Consulting blog post ✓

### Phase 6: OGP Integration
**Timeline:** 1 week
**Deliverables:**
- Dynamics → Actions conversion ✓
- Scheduler integration ✓
- End-to-end scenario ✓

**Total Timeline:** 9 weeks to production-ready

---

## 9. Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Euler step | <1ms | 100 stocks, 200 flows |
| RK4 step | <5ms | 100 stocks, 200 flows |
| 1000-step simulation | <100ms | Euler, streaming |
| Model generation (LLM) | <5s | GPT-4 turbo |
| Sensitivity analysis | <30s | 10 parameters, parallel |
| XYFlow render | <16ms | 60fps, 50 nodes |

---

## 10. Success Criteria

**Technical:**
- ✅ All tests passing (unit, integration, e2e)
- ✅ Typecheck clean with strict mode
- ✅ Zero Effect anti-patterns (no runSync in hot paths)
- ✅ < 10ms p95 for simulation step
- ✅ Schema-validated at every boundary

**Product:**
- ✅ Demo: population model → XYFlow → AI explanation
- ✅ OGP can schedule based on dynamics
- ✅ Consulting blog post generates first client inquiry

**Architectural:**
- ✅ Solvers swappable via Layer
- ✅ Models composable (nested subsystems)
- ✅ Zero XYFlow state bugs (pure atoms)
- ✅ LLM tools callable standalone or agentic

---

## 11. Open Questions

1. **Algebraic loops**: How to detect and resolve circular dependencies in flows?
2. **Model validation**: Schema for equation correctness beyond parsing?
3. **Subsystem composition**: How to nest models as black-box components?
4. **Distributed simulation**: Can we parallelize large models across workers?
5. **WASM acceleration**: When does pure JS hit performance ceiling?

---

## Conclusion

This architecture positions Effect System Dynamics as the **most composable, type-safe, and AI-augmented** system dynamics library in the JS/TS ecosystem. By leveraging Effect's strengths (layers, streams, services) and integrating deeply with lever (graph storage, OGP scheduling, XYFlow rendering), we create a **10x better developer experience** than existing tools while enabling **AI-powered causal analysis** that democratizes system dynamics modeling.

The path from here:
1. **Week 1-2:** Implement Phase 1 (core schemas + euler solver)
2. **Week 3:** Ship Phase 2 (Spanner persistence)
3. **Week 4-5:** Deliver Phase 3 (XYFlow visualization)
4. **Week 6:** Polish Phase 4 (RK4 + adaptive)
5. **Week 7-8:** Launch Phase 5 (AI tools)
6. **Week 9:** Integrate Phase 6 (OGP)

9 weeks to a killer demo that shows: natural language → AI generates model → simulation runs → XYFlow visualizes → leverage points → OGP schedules actions.

That demo = consulting business. 🚀
