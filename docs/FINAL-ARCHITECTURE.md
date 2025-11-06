# Effect System Dynamics - Final Architecture

**Version:** 1.0.0
**Date:** 2025-10-30
**Status:** Approved for Implementation

---

## 1. Executive Summary

building the **most composable, type-safe, effect-native system dynamics library** in typescript. pure core, modular persistence/ui, lever integration as consumer.

### key architectural decisions

1. **zero coupling in core**: `@org/effect-system-dynamics` is publishable to npm with no lever dependencies
2. **clone scottfr patterns, reject architecture**: multi-method modeling (sd+abm), units, equation dsl, rk4 rollback → but immutable ref-based, not mutable primitives
3. **effect.graph for dependencies**: use built-in toposort + cycle detection for equation ordering, not custom graph traversal
4. **defer abm to v2**: design integration points now, ship agent-based modeling as separate package after validating sd-only demand
5. **streaming simulation**: `Stream.unfold` for time-stepping with backpressure + cancellation, not batch-only results

### what makes this unique

- **functional purity**: immutable `Ref` state, composable `Effect` services, no global god objects
- **schema-first**: `Schema.Class` for stocks/flows with compile-time + runtime validation
- **graph-native**: persists to spanner graph schemaless tables, queryable with gql
- **ai-augmented**: llm tools for model generation, sensitivity analysis, scenario explanation via `@effect/ai`
- **visualization-ready**: xyflow custom nodes/edges with live simulation overlays via effect-atom

---

## 2. Package Structure (Monorepo)

```
packages/
├── effect-system-dynamics/        # CORE (v1) - pure, portable
│   ├── src/
│   │   ├── Stock.ts               # branded stock schema
│   │   ├── Flow.ts                # flow with rate equations
│   │   ├── Variable.ts            # auxiliary/constant variables
│   │   ├── Model.ts               # model container schema
│   │   ├── Solver.ts              # solver service interface
│   │   ├── Equation.ts            # equation parser/evaluator
│   │   ├── Units.ts               # dimensional analysis system
│   │   ├── Simulation.ts          # simulation orchestration
│   │   └── index.ts
│   ├── test/
│   │   ├── solvers.test.ts        # euler, rk4, adaptive tests
│   │   ├── equations.test.ts      # parser + evaluator
│   │   └── units.test.ts          # unit conversion
│   ├── docs/
│   │   ├── ARCHITECTURE.md        # original design (archived)
│   │   ├── FINAL-ARCHITECTURE.md  # this file
│   │   └── examples/
│   │       ├── population.ts      # exponential growth
│   │       ├── sir.ts             # epidemic model
│   │       └── predator-prey.ts   # lotka-volterra
│   ├── package.json               # deps: effect, @effect/schema only
│   └── tsconfig.json
│
├── effect-system-dynamics-persistence/  # PERSISTENCE (v1.1)
│   ├── src/
│   │   ├── ModelRepository.ts     # abstract repo interface
│   │   ├── SpannerRepo.ts         # spanner graph implementation
│   │   └── index.ts
│   ├── test/
│   │   └── spanner.test.ts
│   └── package.json               # deps: core + @org/effect-spanner-graph
│
├── effect-system-dynamics-ui/          # UI (v1.2)
│   ├── src/
│   │   ├── nodes/
│   │   │   ├── StockNode.tsx      # xyflow stock component
│   │   │   ├── VariableNode.tsx   # circular variable node
│   │   │   └── ParameterNode.tsx  # slider parameter node
│   │   ├── edges/
│   │   │   └── FlowEdge.tsx       # pipe with valve edge
│   │   ├── atoms/
│   │   │   ├── graph-atoms.ts     # effect-atom wrappers
│   │   │   └── sim-atoms.ts       # simulation state atoms
│   │   └── index.ts
│   ├── test/
│   │   └── components.test.tsx
│   └── package.json               # deps: core + @xyflow/react + effect-atom
│
├── effect-abm/                         # AGENT-BASED (v2) - separate package
│   ├── src/
│   │   ├── Agent.ts               # agent schema + behavior
│   │   ├── Environment.ts         # environment service
│   │   ├── SpatialIndex.ts        # kdtree for neighbor queries
│   │   ├── Scheduler.ts           # agent activation scheduler
│   │   └── index.ts
│   ├── test/
│   │   ├── agents.test.ts
│   │   └── spatial.test.ts
│   └── package.json               # deps: effect only
│
└── effect-simulation/                  # HYBRID (v3) - optional orchestrator
    ├── src/
    │   ├── HybridModel.ts         # sd + abm integration
    │   ├── Integration.ts         # agents→stocks, stocks→agents
    │   └── index.ts
    └── package.json               # deps: core + abm

lever/ (separate repo)
├── packages/
│   └── server/src/domain/system-dynamics/  # lever-specific integration
│       ├── sd-rpc-live.ts         # rpc handlers using persistence package
│       ├── sd-client.ts           # api client
│       └── endpoints.ts           # httpapi group
```

### dependency graph

```
@org/effect-system-dynamics (CORE - no external deps except effect)
  ↓ consumed by
  ├─ @org/effect-system-dynamics-persistence
  │    ↓ consumed by lever/server
  ├─ @org/effect-system-dynamics-ui
  │    ↓ consumed by lever/client
  └─ @org/effect-abm (v2)
       ↓ consumed by @org/effect-simulation (v3)
```

**rationale:**
- core is **publishable to npm** with zero lever coupling
- users choose what to install (`pnpm add @org/effect-system-dynamics` for pure sd)
- lever becomes a **consumer/integrator**, not owner
- separate versioning: core can hit 1.0 while persistence/ui/abm are 0.x

---

## 3. Core Library API (`@org/effect-system-dynamics`)

### 3.1 schema definitions

```typescript
// Stock - accumulator of quantity
export class StockId extends Schema.String.pipe(Schema.brand("StockId")) {}

export class Stock extends Schema.Class<Stock>("Stock")({
  id: StockId,
  name: Schema.String,
  initialValue: Schema.Number,
  units: Schema.optional(Schema.String),
  bounds: Schema.optional(Schema.Struct({
    min: Schema.NullOr(Schema.Number),
    max: Schema.NullOr(Schema.Number)
  }))
}) {}

// Flow - rate of change between stocks
export class FlowId extends Schema.String.pipe(Schema.brand("FlowId")) {}

export class Flow extends Schema.Class<Flow>("Flow")({
  id: FlowId,
  name: Schema.String,
  source: Schema.NullOr(StockId), // null = cloud (infinite source)
  target: Schema.NullOr(StockId), // null = cloud (infinite sink)
  rateEquation: Equation,          // parsed equation AST
  units: Schema.optional(Schema.String)
}) {}

// Variable - computed auxiliary or constant parameter
export class VariableId extends Schema.String.pipe(Schema.brand("VariableId")) {}

export class Variable extends Schema.Class<Variable>("Variable")({
  id: VariableId,
  name: Schema.String,
  type: Schema.Literal("auxiliary", "constant"),
  equation: Schema.optional(Equation),  // null for constants
  constantValue: Schema.optional(Schema.Number),
  units: Schema.optional(Schema.String)
}) {}

// Model - container for stocks, flows, variables
export class ModelId extends Schema.String.pipe(Schema.brand("ModelId")) {}

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
  step: Schema.Number,
  units: Schema.Literal("seconds", "minutes", "hours", "days", "weeks", "months", "years")
}) {}
```

### 3.2 simulation state

```typescript
// SimState - point-in-time snapshot
export class SimState extends Schema.Class<SimState>("SimState")({
  time: Schema.Number,
  stocks: Schema.Record({ key: StockId, value: Schema.Number }),
  flows: Schema.Record({ key: FlowId, value: Schema.Number }),
  variables: Schema.Record({ key: VariableId, value: Schema.Number })
}) {}

// SimResult - complete time series
export class SimResult extends Schema.Class<SimResult>("SimResult")({
  modelId: ModelId,
  states: Schema.Array(SimState),
  metadata: Schema.Struct({
    solver: Schema.String,
    steps: Schema.Number,
    duration: Schema.Number // milliseconds
  })
}) {}
```

### 3.3 solver service

```typescript
// Solver interface - swappable via layers
export interface Solver {
  readonly name: string
  readonly step: (
    model: Model,
    state: SimState,
    dt: number
  ) => Effect.Effect<SimState, SolverError>
}

export class Solver extends Context.GenericTag<Solver>("@org/effect-system-dynamics/Solver") {}

// Euler implementation (greedy - <50ms)
export const EulerSolver = Layer.succeed(
  Solver,
  {
    name: "euler",
    step: (model, state, dt) =>
      Effect.gen(function* () {
        // evaluate all flows at current state
        const rates = yield* evaluateFlows(model.flows, state)

        // integrate stocks: stock[t+dt] = stock[t] + rate[t] * dt
        const nextStocks = Object.fromEntries(
          model.stocks.map(stock => [
            stock.id,
            state.stocks[stock.id] + (rates[stock.id] ?? 0) * dt
          ])
        )

        // recompute variables
        const nextVariables = yield* evaluateVariables(model.variables, nextStocks)

        return new SimState({
          time: state.time + dt,
          stocks: nextStocks,
          flows: rates,
          variables: nextVariables
        })
      })
  }
)

// RK4 implementation (local search - <500ms)
export const RK4Solver = Layer.succeed(
  Solver,
  {
    name: "rk4",
    step: (model, state, dt) =>
      Effect.gen(function* () {
        // stage 1: evaluate at t=0
        const k1 = yield* evaluateDerivatives(model, state)
        const snapshot = yield* Ref.make(state.stocks)

        // stage 2: evaluate at t=dt/2 with k1/2
        yield* applyRates(model, k1, dt / 2)
        const k2 = yield* evaluateDerivatives(model, state)
        yield* Ref.set(snapshot, state.stocks) // rollback

        // stage 3: evaluate at t=dt/2 with k2/2
        yield* applyRates(model, k2, dt / 2)
        const k3 = yield* evaluateDerivatives(model, state)
        yield* Ref.set(snapshot, state.stocks) // rollback

        // stage 4: evaluate at t=dt with k3
        yield* applyRates(model, k3, dt)
        const k4 = yield* evaluateDerivatives(model, state)
        yield* Ref.set(snapshot, state.stocks) // rollback

        // stage 5: blend (k1 + 2k2 + 2k3 + k4)/6
        const blended = blendRates([k1, k2, k3, k4], [1, 2, 2, 1], 6)
        yield* applyRates(model, blended, dt)

        return yield* captureState(model, state.time + dt)
      })
  }
)
```

### 3.4 simulation orchestration

```typescript
// main simulation function - returns stream of states
export const simulate = (
  model: Model
): Effect.Effect<Stream.Stream<SimState, SolverError>, SolverError, Solver> =>
  Effect.gen(function* () {
    const solver = yield* Solver
    const initialState = yield* initializeState(model)

    return Stream.unfold(initialState, (state) =>
      Effect.gen(function* () {
        if (state.time >= model.timeConfig.end) {
          return Option.none() // termination
        }

        const nextState = yield* solver.step(model, state, model.timeConfig.step)
        return Option.some([state, nextState]) // emit current, carry next
      })
    )
  })

// convenience: run to completion
export const simulateComplete = (
  model: Model
): Effect.Effect<SimResult, SolverError, Solver> =>
  Effect.gen(function* () {
    const start = Date.now()
    const stateStream = yield* simulate(model)
    const states = yield* Stream.runCollect(stateStream)

    return new SimResult({
      modelId: model.id,
      states: Chunk.toArray(states),
      metadata: {
        solver: (yield* Solver).name,
        steps: states.length,
        duration: Date.now() - start
      }
    })
  })
```

---

## 4. Cloned Patterns from scottfr/simulation

### 4.1 rk4 solver with rollback

**scottfr (imperative mutable):**
```javascript
// stocks mutate this.level directly, rollback via preserveLevel/restoreLevel
class SStock {
  preserveLevel() { this.oldLevel = this.level.fullClone() }
  restoreLevel() { this.level = this.oldLevel }
}

// task scheduler with time-shift
addRK4Task(t + dt/2, () => {
  evaluate_k2()
  tasks.moveTo(t) // time-shift back
})
```

**effect version (immutable ref-based):**
```typescript
// snapshot stock state in Ref
const snapshot = yield* Ref.make(state.stocks)

// evaluate intermediate stage
const k2 = yield* evaluateDerivatives(model, intermediateState)

// rollback: restore from snapshot
yield* Ref.set(model.stocksRef, yield* Ref.get(snapshot))
```

**key improvement:** no mutable `this.level`, no global task queue. pure effect with explicit state management.

---

### 4.2 unit system with dimensional analysis

**scottfr (class-based units):**
```javascript
class Material {
  constructor(value, units) {
    this.value = value
    this.units = units // UnitStore with names/powers
  }
}

function convertUnits(from, to) {
  if (from.names !== to.names) return 0 // error
  return from.toBase / to.toBase
}
```

**effect version (schema-based units):**
```typescript
export class UnitStore extends Schema.Class<UnitStore>("UnitStore")({
  names: Schema.Array(Schema.String),  // ["meter", "second"]
  powers: Schema.Array(Schema.Number), // [1, -1] → meter/second
  toBase: Schema.Number // conversion factor
}) {}

export class Material extends Schema.Class<Material>("Material")({
  value: Schema.Number,
  units: Schema.NullOr(UnitStore)
}) {}

export const convertUnits = (
  from: Material,
  to: UnitStore
): Effect.Effect<number, UnitError> =>
  Effect.gen(function* () {
    if (!from.units || !to) {
      return yield* Effect.fail(new UnitError("incompatible units"))
    }

    // check dimensional compatibility
    const compatible = yield* checkDimensionalEquivalence(from.units, to)
    if (!compatible) {
      return yield* Effect.fail(
        new UnitError(`cannot convert ${from.units.toString()} to ${to.toString()}`)
      )
    }

    return from.units.toBase / to.toBase
  })
```

**benefits:** typed errors in effect channel, schema validation, no silent `0` returns.

**current status (2025-10-30):**
- Quantities flow through the solver end-to-end; every `SimState` snapshot now exposes a `units` record for stocks, variables, flow rates, and time.
- Flow equations must evaluate to **stock ÷ time**. When a flow bridges two stocks we require identical stock units before combining the rate contributions.
- We deliberately do *not* auto-convert between unrelated units. Model authors express conversions explicitly inside the equation DSL (e.g. divide by `{ 24 hour }`). This keeps failure modes loud and avoids baking a brittle unit ontology into the engine.
- `Units.ts` implements `UnitDefinition`, `UnitRegistry`, and explicit helpers (`convertValue`, `convertQuantity`, `quantityFromUnit`) so applications can normalise values between compatible units without affecting solver behaviour.

---

### 4.3 equation dsl with references

**scottfr (string-based ast):**
```javascript
// equation: "[Population] * [Growth Rate]"
// parsed to AST, evaluated via tree walking

function evaluateTree(tree, localVars, simulate) {
  switch (tree.type) {
    case "primitive":
      return localVars.get(tree.name.toLowerCase()).value()
    case "binop":
      const left = evaluateTree(tree.left, ...)
      const right = evaluateTree(tree.right, ...)
      return operators[tree.op](left, right)
  }
}
```

**effect version (parsed ast → effect pipeline):**
```typescript
export type Equation =
  | { type: "primitive", name: string }
  | { type: "constant", value: number }
  | { type: "binop", op: string, left: Equation, right: Equation }
  | { type: "function", name: string, args: Equation[] }

export const evaluateEquation = (
  eq: Equation,
  ctx: ModelContext
): Effect.Effect<Material, EvaluationError, ModelContext> =>
  Effect.gen(function* () {
    switch (eq.type) {
      case "primitive":
        return yield* ctx.getPrimitive(eq.name)
      case "constant":
        return new Material({ value: eq.value, units: null })
      case "binop":
        const left = yield* evaluateEquation(eq.left, ctx)
        const right = yield* evaluateEquation(eq.right, ctx)
        return yield* applyOperator(eq.op, left, right)
      case "function":
        const args = yield* Effect.forEach(eq.args, arg => evaluateEquation(arg, ctx))
        return yield* callFunction(eq.name, args)
    }
  })
```

**benefits:**
- composable: equations are effect values
- cacheable: memoize parsed asts
- typed errors: `EvaluationError` vs runtime exceptions

---

### 4.4 agent cloning with shared schemas

**scottfr (per-agent object cloning):**
```javascript
class SPopulation {
  createAgent() {
    let agent = new SAgent()
    for (let dna of this.DNAs) {
      let child = new dna.constructorFunction(this.simulate)
      child.dna = dna
      agent.children.push(child)
    }
    return agent
  }
}
// memory: 1000 agents × 10 primitives × 300 bytes = 3MB
```

**effect version (shared schema, per-agent state):**
```typescript
export const createAgents = (
  population: Population,
  baseAgent: AgentTemplate,
  count: number
): Effect.Effect<Array<Agent>, PopulationError, ModelContext> =>
  Effect.gen(function* () {
    // shared schema: all agents use same primitive definitions
    const schema = yield* AgentSchema.fromTemplate(baseAgent)

    // parallel agent creation
    return yield* Effect.forEach(
      Range.make(0, count),
      (index) =>
        Effect.gen(function* () {
          return new Agent({
            id: `${population.id}-${index}` as Brand<"AgentId">,
            index,
            states: yield* initializeStates(schema.states),
            primitives: yield* initializePrimitives(schema.primitives),
            location: yield* placeAgent(population.placement, index),
            connections: []
          })
        }),
      { concurrency: "unbounded" } // parallel creation
    )
  })
// memory: 1 schema × 10 primitives × 100 bytes + 1000 agents × 10 values × 50 bytes = 500KB
```

**improvement:** 6x memory reduction, parallel creation, immutable agents.

---

## 5. Effect.Graph Integration

### 5.1 equation dependency ordering

**problem:** equations reference each other. must evaluate in correct order to avoid undefined values.

```
[growth_rate] = 0.02
[population] = 1000
[births] = [population] * [growth_rate]  // depends on population, growth_rate
[deaths] = [population] * 0.01           // depends on population
```

**solution:** use effect.graph topological sort.

```typescript
export const buildDependencyGraph = (
  model: Model
): Effect.Effect<Graph.Graph<VariableId, string, "directed">, GraphError> =>
  Effect.gen(function* () {
    return Graph.directed<VariableId, string>((mutable) => {
      // add nodes for all variables
      const nodeMap = new Map<VariableId, Graph.NodeIndex>()
      for (const variable of model.variables) {
        nodeMap.set(variable.id, Graph.addNode(mutable, variable.id))
      }

      // add edges for dependencies
      for (const variable of model.variables) {
        const deps = extractDependencies(variable.equation)
        for (const dep of deps) {
          const sourceNode = nodeMap.get(dep)!
          const targetNode = nodeMap.get(variable.id)!
          Graph.addEdge(mutable, sourceNode, targetNode, "depends-on")
        }
      }
    })
  })

export const getEvaluationOrder = (
  model: Model
): Effect.Effect<Array<VariableId>, GraphError> =>
  Effect.gen(function* () {
    const graph = yield* buildDependencyGraph(model)

    // detect cycles (algebraic loops)
    if (!Graph.isAcyclic(graph)) {
      return yield* Effect.fail(
        new AlgebraicLoopError("circular dependencies detected in equations")
      )
    }

    // topological sort → evaluation order
    const order: Array<VariableId> = []
    for (const nodeIndex of Graph.topo(graph)) {
      const variableId = Graph.getNode(graph, nodeIndex)
      order.push(variableId)
    }

    return order
  })
```

**usage in solver:**
```typescript
const evaluateVariables = (
  variables: Array<Variable>,
  stocks: Record<StockId, number>
): Effect.Effect<Record<VariableId, number>, EvaluationError> =>
  Effect.gen(function* () {
    const evaluationOrder = yield* getEvaluationOrder({ variables, stocks })
    const results: Record<VariableId, number> = {}

    for (const varId of evaluationOrder) {
      const variable = variables.find(v => v.id === varId)!
      const value = yield* evaluateEquation(variable.equation, { stocks, variables: results })
      results[varId] = value
    }

    return results
  })
```

**benefit:** **zero custom graph code**. effect.graph provides industrial-strength toposort with cycle detection out of the box.

---

### 5.2 feedback loop detection

**use case:** identify reinforcing vs balancing loops for sensitivity analysis.

```typescript
export const detectFeedbackLoops = (
  model: Model
): Effect.Effect<Array<FeedbackLoop>, GraphError> =>
  Effect.gen(function* () {
    const graph = yield* buildDependencyGraph(model)
    const loops: Array<FeedbackLoop> = []

    // find strongly connected components (cycles)
    for (const componentNodes of Graph.stronglyConnectedComponents(graph)) {
      if (componentNodes.length > 1) {
        // cycle detected
        const loop = yield* classifyLoop(graph, componentNodes)
        loops.push(loop)
      }
    }

    return loops
  })

const classifyLoop = (
  graph: Graph.Graph<VariableId, string, "directed">,
  nodes: Array<Graph.NodeIndex>
): Effect.Effect<FeedbackLoop> =>
  Effect.gen(function* () {
    // check polarity of edges in cycle
    const edges = yield* extractLoopEdges(graph, nodes)
    const negativeCount = edges.filter(e => e.polarity === "-").length

    return {
      type: negativeCount % 2 === 0 ? "reinforcing" : "balancing",
      variables: nodes.map(n => Graph.getNode(graph, n)),
      strength: yield* estimateLoopStrength(edges)
    }
  })
```

---

## 6. Persistence Layer (`@org/effect-system-dynamics-persistence`)

### 6.1 repository interface (abstract)

```typescript
export interface ModelRepository {
  readonly create: (model: Model) => Effect.Effect<ModelId, RepositoryError>
  readonly get: (id: ModelId) => Effect.Effect<Model, RepositoryError>
  readonly list: () => Effect.Effect<Array<Model>, RepositoryError>
  readonly update: (id: ModelId, updates: Partial<Model>) => Effect.Effect<void, RepositoryError>
  readonly delete: (id: ModelId) => Effect.Effect<void, RepositoryError>
}

export class ModelRepository extends Context.GenericTag<ModelRepository>(
  "@org/effect-system-dynamics-persistence/ModelRepository"
) {}
```

### 6.2 spanner implementation

```typescript
export const SpannerModelRepository = Layer.effect(
  ModelRepository,
  Effect.gen(function* () {
    const client = yield* SpannerGraphClient

    return {
      create: (model) =>
        Effect.gen(function* () {
          const id = yield* generateUUID()

          // insert model node
          yield* client`
            INSERT INTO GraphNode (id, label, properties)
            VALUES (${id}, 'SDModel', ${client.asJSONStatement({
              name: model.name,
              time_config: {
                start: model.timeConfig.start,
                end: model.timeConfig.end,
                step: model.timeConfig.step,
                units: model.timeConfig.units
              }
            })})
          `.pipe(Effect.orDie)

          // insert stocks as child nodes
          for (const stock of model.stocks) {
            yield* client`
              INSERT INTO GraphNode (id, label, properties)
              VALUES (${stock.id}, 'SDStock', ${client.asJSONStatement({
                name: stock.name,
                initial_value: stock.initialValue,
                units: stock.units
              })})
            `.pipe(Effect.orDie)

            // link to model
            yield* client`
              INSERT INTO GraphEdge (source, target, label)
              VALUES (${id}, ${stock.id}, 'CONTAINS')
            `.pipe(Effect.orDie)
          }

          // similar for flows, variables...

          return id as ModelId
        }),

      get: (id) =>
        Effect.gen(function* () {
          // query model + all child nodes/edges
          const result = yield* client.gql<{ model: unknown, stocks: unknown[], flows: unknown[] }>`
            MATCH (m:SDModel WHERE m.id = ${id})
            OPTIONAL MATCH (m)-[:CONTAINS]->(s:SDStock)
            OPTIONAL MATCH (m)-[:CONTAINS]->(f:SDFlow)
            RETURN SAFE_TO_JSON(m) AS model,
                   ARRAY_AGG(SAFE_TO_JSON(s)) AS stocks,
                   ARRAY_AGG(SAFE_TO_JSON(f)) AS flows
          `.pipe(Effect.orDie)

          return yield* Model.decode({
            id,
            name: result.model.properties.name,
            stocks: result.stocks.map(s => Stock.decode(s.properties)),
            flows: result.flows.map(f => Flow.decode(f.properties)),
            timeConfig: result.model.properties.time_config
          })
        })

      // ... list, update, delete omitted for brevity
    }
  })
)
```

**key:** spanner persistence is **not in core**. users can swap in postgres, redis, filesystem, or run in-memory only.

---

## 7. UI Layer (`@org/effect-system-dynamics-ui`)

### 7.1 custom xyflow nodes

```typescript
// StockNode.tsx
export const StockNode: React.FC<NodeProps<StockNodeData>> = ({ data, selected }) => {
  const updateStock = useAtomSet(updateStockMutation)
  const simState = useAtomValue(currentSimStateAtom)

  const currentValue = simState.stocks[data.id] ?? data.initialValue

  return (
    <BaseNode selected={selected} className="stock-node">
      <Handle type="target" position={Position.Left} id="inflow" />

      <div className="stock-header">
        <Database className="stock-icon" />
        <div className="stock-name">{data.name}</div>
      </div>

      <div className="stock-body">
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
          <div className="flow-name">{data.name}</div>
          <div className="flow-rate">{flowRate.toFixed(2)} {data.units}</div>
        </div>
      </EdgeLabelRenderer>
    </BaseEdge>
  )
}
```

### 7.2 effect-atom integration

```typescript
// managed xyflow state (auto-syncs with remote models)
export const xyflowNodesAtom = Atom.writable(
  (get) => {
    const modelsResult = get(sdModelsAtom)
    return Result.match(modelsResult, {
      onSuccess: (models) => convertToXYFlowNodes(models),
      onWaiting: () => [],
      onFailure: () => []
    })
  },
  (ctx, update: NodesUpdate) => {
    const prev = ctx.get(xyflowNodesAtom)
    const next = applyNodesUpdate(prev, update)
    ctx.setSelf(next) // optimistic update

    // persist to server
    return runtime.run(
      Effect.gen(function* () {
        yield* persistNodesUpdate(update)
        yield* invalidate(sdModelsAtom) // trigger re-fetch
      }).pipe(
        Effect.catchAll(() => {
          ctx.setSelf(prev) // rollback on error
          return Effect.unit
        })
      )
    )
  }
)

// real-time simulation state
export const currentSimStateAtom = runtime.atom(() =>
  Effect.gen(function* () {
    const simService = yield* SimulationService
    const activeModelId = yield* getActiveModelId()

    return yield* simService.runLive(activeModelId).pipe(
      Stream.runLast,
      Effect.map(Option.getOrElse(() => initialState))
    )
  })
)
```

---

## 8. ABM Integration Points (Deferred to v2)

### 8.1 design for future abm

**hook point 1: exogenous inputs**

```typescript
// core library provides setExogenous for external drivers
export class Model {
  setExogenous(name: string, value: number): Effect.Effect<void>
}

// future abm integration
const tick = Effect.gen(function* () {
  const consumers = yield* ConsumerPool
  const model = yield* SDModel

  // agents make adoption decisions (abm)
  const decisions = yield* Effect.forEach(
    consumers,
    c => c.decide,
    { concurrency: "unbounded" }
  )

  // aggregate to sd stock flow
  const adoptions = decisions.filter(d => d.adopted).length
  yield* model.setExogenous("adoption_rate", adoptions)

  // sd step
  yield* model.step()
})
```

**hook point 2: stocks as agent constraints**

```typescript
// agents query stock values to constrain behavior
export class Model {
  getStock(name: string): Effect.Effect<number>
}

// future abm integration
const harvestTick = Effect.gen(function* () {
  const harvesters = yield* HarvesterPool
  const model = yield* SDModel

  // check resource availability
  const available = yield* model.getStock("inventory")

  // agents compete for resource
  const consumed = yield* Effect.forEach(
    harvesters,
    h => h.harvest(available / harvesters.length),
    { concurrency: "unbounded" }
  )

  // feed consumption back to sd
  yield* model.setExogenous("consumption_rate", Sum(consumed))
  yield* model.step()
})
```

**documentation:**
```markdown
## Future: Agent-Based Modeling

The core library is designed to integrate with agent-based models via exogenous inputs.

Example: agents driving stock flows

    const adoptions = yield* countAgentAdoptions()
    yield* model.setExogenous("adoption_rate", adoptions)

See `@org/effect-abm` (planned v2) for full agent-based capabilities.
```

---

## 9. Implementation Phases

### phase 1: core library (weeks 1-2)

**scope:**
- stock, flow, variable, model schemas ✓
- euler solver ✓
- equation parser (basic arithmetic + references) ✓
- unit system (schema-based, convert function) ✓
- simulate() with stream.unfold ✓
- tests: population growth, sir epidemic ✓

**deliverables:**
- `packages/effect-system-dynamics/` standalone package
- readme with examples
- publishable to npm (no lever dependencies)

**success criteria:**
- `pnpm check` passes
- 3 example models run successfully
- unit tests cover solvers, equations, units

---

### phase 2: persistence layer (week 3)

**scope:**
- abstract ModelRepository interface ✓
- spanner implementation ✓
- schema transforms (camelCase ↔ snake_case) ✓
- tests with emulator ✓

**deliverables:**
- `packages/effect-system-dynamics-persistence/`
- migration scripts
- integration tests

**success criteria:**
- models persist + retrieve correctly
- graph queries return expected structure

---

### phase 3: ui layer (weeks 4-5)

**scope:**
- StockNode, VariableNode, ParameterNode components ✓
- FlowEdge with valve rendering ✓
- effect-atom wrappers for xyflow state ✓
- live simulation overlay ✓
- tests with react testing library ✓

**deliverables:**
- `packages/effect-system-dynamics-ui/`
- storybook demos
- component tests

**success criteria:**
- nodes render correctly
- simulation values update in real-time
- optimistic updates + rollback work

---

### phase 4: advanced solvers (week 6)

**scope:**
- rk4 solver with rollback ✓
- adaptive solver with error control ✓
- solver benchmarking ✓
- layer-based composition ✓

**deliverables:**
- updated core package
- benchmark results
- performance guide

**success criteria:**
- rk4 matches analytical solutions (error < 1e-6)
- adaptive maintains target tolerance
- euler < 50ms, rk4 < 500ms for 100-step sim

---

### phase 5: ai tools (weeks 7-8)

**scope:**
- GenerateModel, Simulate, SensitivityAnalysis, ExplainDynamics tools ✓
- mcp server ✓
- agentic workflow examples ✓
- lever integration for llm-powered analysis ✓

**deliverables:**
- `packages/effect-system-dynamics/src/ai/` submodule
- mcp manifest
- consulting blog post

**success criteria:**
- llm generates valid models from prompts
- sensitivity analysis ranks parameters correctly
- mcp server runs in claude desktop

---

### phase 6: lever integration (week 9)

**scope:**
- dynamics → ogp actions conversion ✓
- scheduler integration (critical path from simulation) ✓
- outcome → model mapping ✓
- end-to-end demo ✓

**deliverables:**
- `lever/packages/server/src/domain/system-dynamics/`
- rpc handlers
- client atoms
- e2e test

**success criteria:**
- natural language → model → simulation → leverage points → ogp actions
- lever can schedule based on dynamics critical timeline

---

### total timeline: 9 weeks

---

## 10. Success Criteria

### technical

- ✅ all tests passing (unit, integration, e2e)
- ✅ `pnpm check` clean with strict mode
- ✅ zero effect anti-patterns (no runSync in hot paths, no try/catch in effect.gen)
- ✅ < 10ms p95 for euler step (100 stocks, 200 flows)
- ✅ schema-validated at every boundary

### product

- ✅ demo: "model covid lockdown policy" → llm generates seir model → simulation → leverage points → actions
- ✅ ogp schedules actions based on dynamics critical timeline
- ✅ consulting blog post generates first client inquiry

### architectural

- ✅ core library publishable to npm (zero lever coupling)
- ✅ solvers swappable via layer
- ✅ models composable (future: subsystem nesting)
- ✅ zero xyflow state bugs (pure atom management)
- ✅ llm tools callable standalone or agentic

---

## your answer to "start thinking"

**first, best idea:**

build a **system dynamics consulting service** where clients describe their problem in natural language, the llm generates a validated stock-flow model, runs sensitivity analysis to find leverage points, and delivers a strategic roadmap (ogp actions) with timeline.

**dag/critical chain:**
1. natural language problem description (client input)
2. llm → model generation tool → validated model (core lib)
3. simulation tool → baseline scenario (core lib)
4. sensitivity analysis tool → ranked leverage points (core lib)
5. ogp → actions targeting top leverage points (lever integration)
6. scheduler → timeline with critical path (lever integration)
7. deliver: interactive xyflow diagram + strategic roadmap pdf

**monetization paths:**
- consulting engagements ($10k-$50k per model)
- saas for self-service modeling ($99/mo for teams)
- training workshops ($2k/person for 2-day intensive)

**why this works:**
- democratizes system dynamics (no vensim/stella expertise required)
- ai does 80% of modeling work → consultant focuses on strategy
- ogp integration gives actionable timeline, not just pretty diagrams
- effect-native codebase = composable, maintainable, testable

document to: `~/start_thinking_ideas/2025-10-30_lever_system-dynamics-consulting_CLAUDE_sonnet-4.5.md`?

---

**end of final architecture**
