# ABM Inclusion Strategy for Effect System Dynamics

## Executive Summary

**Recommendation: Defer ABM to v2, but architect for it now.**

abm and sd solve fundamentally different problems. sd models aggregate flows (population → births/deaths), abm models heterogeneous individuals (person with unique traits → decisions). hybrid sd+abm models are proven valuable in supply chains, innovation diffusion, and socio-ecological systems.

however, adding abm to the initial effect-sd lib creates significant scope creep:
- separate runtime model (discrete agents vs continuous stocks)
- different performance profile (spatial optimization for 1000s agents)
- distinct visualization needs (individual positions vs aggregate charts)
- doubled api surface

**phased approach:**
1. **v1 (now)**: pure sd library, but design schemas/interfaces expecting future abm integration
2. **v2 (3-6mo)**: `@org/effect-abm` as separate package with clean sd integration points
3. **v3 (optional)**: unified `@org/effect-simulation` orchestrating both

this gives users a focused, production-ready sd lib immediately while preserving the hybrid modeling path.

---

## ABM Fundamentals

### what is agent-based modeling?

abm is bottom-up simulation where autonomous agents with local rules produce emergent system behavior. unlike sd's aggregate differential equations, abm tracks individual entities.

**core concepts:**
- **agent**: autonomous entity with state, behavior, and decision rules
- **environment**: spatial/network context agents inhabit
- **rules**: local behaviors that produce global patterns (e.g., flocking birds)
- **emergence**: macro patterns arising from micro interactions

**example**: pandemic spread
- sd: `susceptible stock → infection_rate * contact → infected stock`
- abm: `Person { age, immune, contacts[] } → infect(other) if within 6ft`

sd captures aggregate dynamics (total infected over time), abm captures heterogeneity (elderly with comorbidities more vulnerable).

### sd vs abm comparison

| dimension | system dynamics | agent-based modeling |
|-----------|----------------|---------------------|
| perspective | top-down, aggregate | bottom-up, individual |
| abstraction | stocks/flows of quantities | discrete entities with traits |
| math foundation | differential equations | rule-based simulation |
| strengths | feedback loops, policy leverage points, computational efficiency | heterogeneity, spatial patterns, emergent behavior |
| weaknesses | loses individual variance, spatial relationships | computationally expensive, harder to parameterize |
| best for | resource flows, population dynamics, system-level feedback | agent interactions, network effects, distributed decisions |

**key difference**: sd asks "how do aggregates change?" while abm asks "how do individuals behave?"

---

## Complementarity: When SD+ABM Shines

hybrid models leverage both paradigms:

### 1. **diffusion of innovation**
- **sd layer**: market-level adoption curves, resource constraints
- **abm layer**: individual adopters with heterogeneous risk tolerance, social networks
- **integration**: agent adoption decisions feed sd stock transitions

```
[SD] total_adopters += adoption_rate
[ABM] Person.adopt() if enough neighbors adopted
[LINK] adoption_rate = count(agents.filter(a => a.adopted))
```

### 2. **supply chain management**
- **sd layer**: inventory levels, production capacity, demand forecasting
- **abm layer**: retailers/distributors with local ordering policies
- **integration**: agent orders drive sd inventory flows, sd shortages constrain agent behavior

### 3. **urban planning**
- **sd layer**: city-wide infrastructure budgets, traffic volumes
- **abm layer**: residents commuting with individual preferences
- **integration**: agent trips aggregate to traffic volumes, congestion affects route choices

### 4. **ecological systems** (classic example from research)
- **sd layer**: lake nutrient cycles, algae bloom dynamics
- **abm layer**: fishermen deciding where/when to fish based on conditions
- **integration**: fishing pressure affects nutrient stocks, water clarity affects fishing decisions

**common pattern**: sd provides the "environment" or "resource base," abm provides heterogeneous actors making decisions within that environment.

---

## Existing Libraries

### javascript/typescript abm landscape

| library | language | maturity | architecture | notes |
|---------|----------|----------|-------------|-------|
| **flocc** | ts | production | rule-based agents, environment orchestrator | netlogo-inspired, 942 stars, actively maintained |
| **agentscript** | js | production | mvc pattern, netlogo semantics | spatial subdivision for performance |
| **agentmaps** | js | niche | geospatial focus | 942 stars, real-world maps |
| **js-simulator** | js | dormant | discrete-event multi-agent | chen0040, 70 stars |
| **scottfr/simulation** | js | unclear | claims sd+abm combo | repo inaccessible during research |

**flocc analysis** (most mature):
- agents are objects with `get/set` for state
- rules defined via `agent.set('tick', fn)` or deprecated `addRule`
- environment calls `executeRules()` then `executeEnqueuedRules()` for two-phase commits
- no built-in concurrency - sequential agent activation

```typescript
// flocc agent pattern
class Agent {
  data: Data = {};

  executeRules() {
    const { tick } = this.data;
    if (tick) {
      Object.assign(this.__newData, tick(this));
    }
  }

  executeEnqueuedRules() {
    this.set(this.__newData); // commit changes
    this.__newData = {};
  }
}

class Environment {
  tick() {
    this.agents.forEach(a => a.executeRules());
    this.agents.forEach(a => a.executeEnqueuedRules());
  }
}
```

**limitations for effect:**
- mutable state everywhere (`this.data`, direct mutation)
- no error handling (exceptions implicit)
- no resource management (manual cleanup)
- sequential only (no fiber-based concurrency)

---

## Effect-Based ABM Architecture

### agents as effect services

**concept**: agents are NOT objects. they're effect services providing state + behavior.

```typescript
// agent as tagged service
export class Agent extends Context.Tag("Agent")<
  Agent,
  {
    readonly id: AgentId
    readonly state: Ref.Ref<AgentState>
    readonly tick: Effect.Effect<void, AgentError>
    readonly neighbors: Effect.Effect<Array<Agent>, SpatialError>
  }
>() {}

// agent state as schema
export class AgentState extends Schema.Class<AgentState>("AgentState")({
  position: Schema.Tuple(Schema.Number, Schema.Number),
  energy: Schema.Number,
  age: Schema.Number,
  traits: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
}) {}
```

**benefits:**
- immutable state via `Ref`
- composable behaviors via `Effect`
- testable (inject mock agents)
- resource-safe (agents clean up in finalizers)

### simulation loop as stream

**concept**: discrete time steps as stream emissions.

```typescript
export const runSimulation = (config: SimConfig) =>
  Effect.gen(function* () {
    const scheduler = yield* AgentScheduler
    const environment = yield* Environment

    return Stream.iterate(0, t => t + 1).pipe(
      Stream.takeWhile(t => t < config.maxTicks),
      Stream.mapEffect(tick =>
        Effect.gen(function* () {
          // phase 1: all agents observe
          const observations = yield* scheduler.observeAll()

          // phase 2: all agents decide (concurrent)
          const actions = yield* scheduler.decideAll(observations).pipe(
            Effect.withConcurrency(config.concurrency)
          )

          // phase 3: environment updates (sequential for consistency)
          yield* environment.applyActions(actions)

          // phase 4: collect metrics
          return yield* environment.snapshot()
        })
      ),
      Stream.runCollect
    )
  })
```

**benefits:**
- backpressure-aware (pause if overwhelmed)
- composable with other streams (merge telemetry)
- cancellable (graceful shutdown)
- time-travel debugging (replay stream)

### agent interactions via queue/ref

**spatial queries**: agents find neighbors via spatial index (kdtree).

```typescript
export class SpatialIndex extends Context.Tag("SpatialIndex")<
  SpatialIndex,
  {
    readonly insert: (agent: Agent) => Effect.Effect<void>
    readonly nearestK: (
      pos: Position,
      k: number
    ) => Effect.Effect<Array<Agent>, SpatialError>
    readonly withinRadius: (
      pos: Position,
      radius: number
    ) => Effect.Effect<Array<Agent>>
  }
>() {}
```

**message passing**: agents communicate via bounded queues.

```typescript
export class AgentMailbox extends Context.Tag("AgentMailbox")<
  AgentMailbox,
  {
    readonly send: (to: AgentId, msg: Message) => Effect.Effect<void>
    readonly receive: Effect.Effect<Option.Option<Message>>
  }
>() {}
```

**state synchronization**: environment holds global state in `Ref`.

```typescript
export class Environment extends Context.Tag("Environment")<
  Environment,
  {
    readonly agents: Ref.Ref<HashMap.HashMap<AgentId, Agent>>
    readonly time: Ref.Ref<number>
    readonly addAgent: (agent: Agent) => Effect.Effect<void>
    readonly removeAgent: (id: AgentId) => Effect.Effect<void>
  }
>() {}
```

---

## SD+ABM Integration Patterns

### pattern 1: agents modify sd stocks

agents make local decisions that aggregate to stock changes.

```typescript
// sd model
export class MarketModel extends Schema.Class<MarketModel>("MarketModel")({
  adopters: Stock({ initial: 0 }),
  potential: Stock({ initial: 1000 }),
  adoption_rate: Flow({
    from: "potential",
    to: "adopters",
    equation: "abm_adoptions_per_tick"
  }),
}) {}

// abm agents
export class Consumer extends Context.Tag("Consumer")<Consumer, {
  readonly decide: Effect.Effect<AdoptionDecision>
}>() {}

// integration
export const tick = Effect.gen(function* () {
  const consumers = yield* ConsumerPool
  const model = yield* SDModel

  // abm phase
  const decisions = yield* Effect.forEach(
    consumers,
    c => c.decide,
    { concurrency: "unbounded" }
  )

  // aggregate to sd
  const adoptions = decisions.filter(d => d.adopted).length
  yield* model.setExogenous("abm_adoptions_per_tick", adoptions)

  // sd phase
  yield* model.step()
})
```

### pattern 2: sd stocks constrain agents

resource scarcity from sd affects agent behavior.

```typescript
// sd model
export class ResourceModel extends Schema.Class<ResourceModel>("ResourceModel")({
  inventory: Stock({ initial: 100 }),
  depletion: Flow({
    from: "inventory",
    to: "sink",
    equation: "consumption_rate"
  }),
}) {}

// abm agents
export class Harvester extends Context.Tag("Harvester")<Harvester, {
  readonly harvest: (available: number) => Effect.Effect<number>
}>() {}

// integration
export const tick = Effect.gen(function* () {
  const harvesters = yield* HarvesterPool
  const model = yield* SDModel

  // check sd constraint
  const available = yield* model.getStock("inventory")

  // agents compete for resource
  const requests = yield* Effect.forEach(
    harvesters,
    h => h.harvest(available / harvesters.length),
    { concurrency: "unbounded" }
  )

  // update sd based on actual consumption
  const consumed = Math.min(available, Sum(requests))
  yield* model.setExogenous("consumption_rate", consumed)
  yield* model.step()
})
```

### pattern 3: sd provides spatial environment

sd models diffusion/transport, agents move through it.

```typescript
// sd model with spatial grid
export class DiffusionModel extends Schema.Class<DiffusionModel>("DiffusionModel")({
  concentration: GridStock({ nx: 50, ny: 50, initial: 0 }),
  diffusion: GridFlow({
    equation: "laplacian(concentration) * diffusion_coeff"
  }),
}) {}

// abm agents
export class Particle extends Context.Tag("Particle")<Particle, {
  readonly position: Ref.Ref<[number, number]>
  readonly move: Effect.Effect<void>
}>() {}

// integration
export const tick = Effect.gen(function* () {
  const particles = yield* ParticlePool
  const model = yield* SDModel

  // sd diffusion step
  yield* model.step()

  // agents sense local gradient and move
  yield* Effect.forEach(
    particles,
    p => Effect.gen(function* () {
      const [x, y] = yield* Ref.get(p.position)
      const gradient = yield* model.getGradient("concentration", x, y)
      const newPos = [x + gradient[0], y + gradient[1]]
      yield* Ref.set(p.position, newPos)
    }),
    { concurrency: "unbounded" }
  )
})
```

---

## Package Structure

### option a: monorepo (recommended)

```
packages/
├── effect-system-dynamics/    # pure sd (v1)
│   ├── src/
│   │   ├── Stock.ts
│   │   ├── Flow.ts
│   │   ├── Simulator.ts
│   │   └── index.ts
│   └── test/
├── effect-abm/                # pure abm (v2)
│   ├── src/
│   │   ├── Agent.ts
│   │   ├── Environment.ts
│   │   ├── SpatialIndex.ts
│   │   ├── Scheduler.ts
│   │   └── index.ts
│   └── test/
└── effect-simulation/         # hybrid orchestrator (v3, optional)
    ├── src/
    │   ├── HybridModel.ts
    │   ├── Integration.ts
    │   └── index.ts
    └── test/
```

**rationale:**
- clear separation of concerns
- users choose what to install (`pnpm add @org/effect-system-dynamics` for pure sd)
- independent versioning (sd can hit 1.0 while abm is 0.x)
- shared types via `@org/effect-simulation-types` if needed

### option b: unified package

```
packages/
└── effect-simulation/
    ├── src/
    │   ├── sd/
    │   ├── abm/
    │   ├── hybrid/
    │   └── index.ts
    └── test/
```

**downsides:**
- larger bundle for users who only want sd
- single version number (abm experimental drags down sd 1.0)
- api surface confusion (too many concepts)

**verdict**: go with monorepo.

---

## Complexity vs Value Analysis

### complexity added by abm

| dimension | sd only | sd + abm | delta |
|-----------|---------|----------|-------|
| core concepts | 5 (stock, flow, sim, model, equation) | 10 (+agent, environment, scheduler, mailbox, spatial) | +100% |
| api surface | ~20 functions | ~40 functions | +100% |
| performance profile | differential equations (fast) | discrete agents (slow at scale) | -10x for 1000 agents |
| testing complexity | unit tests for integrators | + spatial correctness, concurrency | +50% |
| docs burden | 1 tutorial, api ref | 2 tutorials, integration guide | +150% |
| user learning curve | learn sd fundamentals | + learn abm + when to use which | steep |

### value provided by abm

**unique capabilities:**
- heterogeneous agents (can't model in sd without explosion of stocks)
- spatial patterns (flocking, segregation, clustering)
- network effects (diffusion through social graphs)
- adaptive behavior (agents learn, evolve policies)

**practical use cases:**
- supply chains with heterogeneous suppliers
- epidemiology with age/behavior stratification
- markets with diverse investor strategies
- traffic with individual routing preferences

**market demand**: unclear. need user research. sd alone serves:
- business strategy (vensim/stella replacement)
- climate modeling (aggregates are primary)
- macro policy analysis (interest rates, employment)

abm becomes valuable when:
- heterogeneity drives outcomes (inequality, adoption, behavior)
- spatial/network structure matters
- emergent patterns are the research question

**verdict**: abm is powerful but niche. don't bloat v1 with it.

---

## Use Case Scenarios: SD+ABM Power

### scenario 1: covid policy evaluation

**problem**: model lockdown policies balancing health (minimize deaths) and economy (minimize gdp loss).

**sd layer:**
- healthcare capacity (beds, ventilators as stocks)
- economic activity (gdp flow)
- aggregate infection dynamics (SEIR stocks)

**abm layer:**
- individuals with age, job sector, household, contacts
- daily decisions: go to work? visit family? wear mask?
- heterogeneous risk tolerance and compliance

**integration:**
- agent contacts → infection events → update SEIR stocks
- hospital capacity from sd → affects agent mortality
- lockdown policies → constrain agent movement

**why hybrid beats pure sd:** lockdown compliance varies by demographics. pure sd would need separate stocks for every age×income×sector combo (explosion). abm captures heterogeneity naturally.

**why hybrid beats pure abm:** hospital capacity, icu utilization, ventilator supply are aggregate resources. modeling individual hospital beds as agents is wasteful. sd handles aggregates efficiently.

### scenario 2: innovation diffusion in enterprise

**problem**: predict saas adoption across departments in large org.

**sd layer:**
- budget allocation (flow from central it to departments)
- license utilization (stock of active seats)
- renewal dynamics (churn flow)

**abm layer:**
- employees with roles, teams, influence networks
- adoption decisions based on peer usage, manager mandate
- champions who evangelize

**integration:**
- agent adoptions → increment license stock
- budget constraints from sd → limit new department onboarding
- usage metrics from sd → affect agent perception ("everyone uses it")

**why hybrid:** can't model org politics/social proof in sd. can't model budget/renewal flows per-agent (too granular).

### scenario 3: supply chain resilience

**problem**: test supply chain robustness to demand shocks.

**sd layer:**
- inventory levels at warehouses (stocks)
- production capacity, lead times (flows)
- demand forecasting (exogenous)

**abm layer:**
- retailers with local ordering policies (e.g., order when inventory < threshold)
- distributors routing shipments based on urgency
- manufacturers prioritizing high-value customers

**integration:**
- agent orders → drive inventory depletion in sd
- sd stockouts → force agent policy changes (emergency suppliers)
- lead times from sd → affect agent reorder timing

**why hybrid:** inventory dynamics are continuous (sd), but ordering decisions are discrete events by heterogeneous actors (abm).

---

## Performance Considerations

### abm scaling challenges

**agent count vs performance:**
- 10 agents: negligible overhead
- 100 agents: ~10ms/tick (acceptable for real-time)
- 1,000 agents: ~100ms/tick (needs optimization)
- 10,000 agents: ~1s/tick (requires spatial indexing, fiber batching)

**bottlenecks:**
1. **spatial queries**: naive O(n²) neighbor search kills performance
2. **state updates**: concurrent writes to shared state need locks
3. **message passing**: unbounded queues cause memory bloat

### effect overhead mitigation

**concern**: effect's runtime (fibers, tracing, error handling) adds overhead vs raw js loops.

**measurements needed** (future work):
- flocc benchmark: 1000 agents, 100 ticks, simple rule → measure baseline
- effect version with same logic → measure overhead
- effect with spatial optimization → measure gain

**hypothesis**: spatial indexing gains (O(n log n) vs O(n²)) will dwarf effect overhead (~10-20%).

**mitigation strategies:**

#### 1. batch agent updates

```typescript
// bad: launch 1000 fibers
yield* Effect.forEach(agents, a => a.tick, { concurrency: "unbounded" })

// good: batch into 10 groups of 100
yield* Effect.forEach(
  Chunk.chunksOf(agents, 100),
  batch => Effect.forEach(batch, a => a.tick, { concurrency: 10 }),
  { concurrency: 1 }
)
```

#### 2. spatial indexing (kdtree)

```typescript
export const makeKDTree = Effect.gen(function* () {
  const tree = yield* Ref.make(KDTree.empty)

  return {
    insert: (agent: Agent) =>
      Ref.update(tree, t => KDTree.insert(t, agent)),

    nearestK: (pos: Position, k: number) =>
      Ref.get(tree).pipe(
        Effect.map(t => KDTree.nearestK(t, pos, k))
      )
  }
})
```

#### 3. dirty flagging

only update spatial index when agents move.

```typescript
export const tick = Effect.gen(function* () {
  const moved = yield* Effect.forEach(
    agents,
    a => a.tick.pipe(Effect.map(didMove => [a, didMove])),
    { concurrency: "unbounded" }
  )

  // only reindex agents that moved
  const movers = moved.filter(([_, moved]) => moved).map(([a]) => a)
  yield* SpatialIndex.reindex(movers)
})
```

#### 4. use streams for large sims

avoid loading all agents in memory.

```typescript
export const runLargeSimulation = (agentStream: Stream.Stream<Agent>) =>
  agentStream.pipe(
    Stream.grouped(1000), // process 1000 at a time
    Stream.mapEffect(batch => processBatch(batch)),
    Stream.runCollect
  )
```

---

## Phased Implementation

### phase 1 (now): pure sd - v0.1.0

**scope:**
- `Stock`, `Flow`, `Simulator`, `Model` schemas
- runge-kutta integrator with adaptive step
- equation parsing (basic arithmentic, builtins)
- tests + docs

**deliverables:**
- `packages/effect-system-dynamics/`
- readme with sir model example
- api docs

**timeline**: 2-3 weeks

**success criteria**: can model classic sd archetypes (exponential growth, s-curve, oscillation).

### phase 2 (3-6mo): pure abm - v0.1.0

**scope:**
- `Agent`, `Environment`, `Scheduler` services
- spatial indexing (kdtree)
- rule-based behavior + message passing
- tests + docs

**deliverables:**
- `packages/effect-abm/`
- readme with flocking example
- api docs

**timeline**: 4-6 weeks

**success criteria**: can model classic abm examples (segregation, flocking, sugarscape).

**dependencies**: phase 1 complete (use sd integration as motivating example).

### phase 3 (optional): hybrid orchestration - v0.1.0

**scope:**
- `HybridModel` schema combining sd + abm
- integration patterns (agents→stocks, stocks→agents)
- shared clock + event scheduling
- tests + docs

**deliverables:**
- `packages/effect-simulation/`
- readme with hybrid supply chain example
- integration guide

**timeline**: 2-3 weeks

**success criteria**: can replicate published hybrid model (e.g., anylogic supply chain tutorial).

**decision point**: only pursue if user demand emerges. may not be needed if users compose manually.

---

## Recommendation: Defer ABM, Design for It

### why defer

1. **focus**: ship production-ready sd lib without scope creep
2. **validation**: confirm user demand before investing in abm
3. **learning**: absorb sd patterns before tackling abm complexity
4. **iteration**: easier to add abm later than refactor tangled hybrid

### how to prepare

**design sd interfaces expecting abm:**

```typescript
// exogenous inputs can come from agents
export class Model {
  setExogenous(name: string, value: number): Effect.Effect<void>
}

// stocks can be read by agents
export class Model {
  getStock(name: string): Effect.Effect<number>
}
```

**document integration points:**

```markdown
## Future: Agent-Based Integration

Stocks can be updated by external sources:

    const adoptions = yield* countAgentAdoptions()
    yield* model.setExogenous("adoption_rate", adoptions)

This enables hybrid agent-based + system dynamics models.
```

**reserve package names:**
- `@org/effect-abm`
- `@org/effect-simulation`

### evaluation triggers

**ship abm if:**
- 3+ users request abm features (github issues)
- competitor ships effect-based abm (market pressure)
- compelling use case emerges (consulting project needs it)

**skip abm if:**
- sd alone satisfies 90% of use cases
- performance concerns dominate (users want speed over heterogeneity)
- maintenance burden too high (small team)

---

## Appendix: Effect API Sketch

### abm core types

```typescript
export class AgentId extends Schema.String.pipe(Schema.brand("AgentId")) {}

export class Position extends Schema.Class<Position>("Position")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class AgentState extends Schema.Class<AgentState>("AgentState")({
  id: AgentId,
  position: Position,
  energy: Schema.Number,
  traits: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
}) {}

export class AgentBehavior extends Schema.Class<AgentBehavior>("AgentBehavior")({
  observe: Schema.Function(
    Schema.Struct({}),
    Schema.Unknown
  ),
  decide: Schema.Function(
    Schema.Struct({ observation: Schema.Unknown }),
    Schema.Unknown
  ),
  act: Schema.Function(
    Schema.Struct({ decision: Schema.Unknown }),
    Schema.Unknown
  ),
}) {}
```

### agent service

```typescript
export class Agent extends Context.Tag("Agent")<
  Agent,
  {
    readonly id: AgentId
    readonly state: Ref.Ref<AgentState>
    readonly tick: Effect.Effect<void, AgentError>
  }
>() {}

export const makeAgent = (
  initialState: AgentState,
  behavior: AgentBehavior
): Effect.Effect<Agent, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initialState)

    const tick = Effect.gen(function* () {
      const current = yield* Ref.get(state)
      const observation = yield* Effect.sync(() => behavior.observe({}))
      const decision = yield* Effect.sync(() => behavior.decide({ observation }))
      const action = yield* Effect.sync(() => behavior.act({ decision }))

      // update state based on action
      yield* Ref.update(state, s => ({ ...s, ...action }))
    })

    return Agent.of({ id: initialState.id, state, tick })
  }).pipe(
    Effect.withSpan("Agent.make")
  )
```

### environment service

```typescript
export class Environment extends Context.Tag("Environment")<
  Environment,
  {
    readonly agents: Ref.Ref<HashMap.HashMap<AgentId, Agent>>
    readonly time: Ref.Ref<number>
    readonly addAgent: (agent: Agent) => Effect.Effect<void>
    readonly removeAgent: (id: AgentId) => Effect.Effect<void>
    readonly tick: Effect.Effect<EnvironmentSnapshot>
  }
>() {}

export const makeEnvironment: Effect.Effect<
  Environment,
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const agents = yield* Ref.make(HashMap.empty<AgentId, Agent>())
  const time = yield* Ref.make(0)

  const tick = Effect.gen(function* () {
    const agentList = yield* Ref.get(agents).pipe(
      Effect.map(HashMap.values),
      Effect.map(Array.from)
    )

    // parallel agent ticks
    yield* Effect.forEach(
      agentList,
      a => a.tick,
      { concurrency: "unbounded" }
    )

    yield* Ref.update(time, t => t + 1)

    return {
      time: yield* Ref.get(time),
      agentCount: agentList.length,
    }
  })

  return Environment.of({
    agents,
    time,
    addAgent: (agent) =>
      Ref.update(agents, HashMap.set(agent.id, agent)),
    removeAgent: (id) =>
      Ref.update(agents, HashMap.remove(id)),
    tick,
  })
})
```

### simulation runner

```typescript
export const runSimulation = (config: {
  maxTicks: number
  concurrency: number
}) =>
  Effect.gen(function* () {
    const env = yield* Environment

    return Stream.iterate(0, t => t + 1).pipe(
      Stream.takeWhile(t => t < config.maxTicks),
      Stream.mapEffect(_ => env.tick),
      Stream.tap(snapshot =>
        Effect.sync(() => console.log(`tick ${snapshot.time}: ${snapshot.agentCount} agents`))
      ),
      Stream.runCollect
    )
  })
```

---

## Conclusion

abm is powerful but orthogonal to sd. hybrid models are proven valuable but add significant complexity. for a focused v1, ship pure sd with integration hooks. evaluate abm demand post-launch. if pursued, build as separate `@org/effect-abm` package with clean interfaces.

the functional patterns (agents as services, simulation as stream, state in ref) align beautifully with effect. performance is manageable with spatial indexing. but don't let abm derail sd launch.

**final answer: defer to v2, prepare now, decide based on user demand.**
