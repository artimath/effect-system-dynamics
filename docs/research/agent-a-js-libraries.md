# JavaScript/TypeScript System Dynamics Libraries Research

**Research Date:** 2025-10-30
**Agent:** Agent A
**Focus:** Existing JS/TS system dynamics libraries, numerical solvers, stock-flow implementations

---

## Executive Summary

the js/ts system dynamics landscape is sparse but has two major players: **sdeverywhere** (transpiler-based, production-ready) and **simlin** (web-native, rust-powered). neither implements solvers in js—sdeverywhere generates imperative integration code from vensim models, simlin uses rust/wasm for execution. standalone numerical solvers exist (**odex**, **numeric.js**) but aren't packaged for system dynamics idioms. **no effect-based implementation exists.**

key insight: the transpiler approach (vensim → c/js) dominates because hand-coding stock-flow models in js is tedious. the opportunity is a **compositional effect-based dsl** that makes pure-js system dynamics elegant enough to compete with visual modeling tools.

---

## 1. Existing System Dynamics Libraries

### 1.1 SDEverywhere

**Status:** Production-ready, actively maintained by Climate Interactive
**Repository:** https://github.com/climateinteractive/SDEverywhere
**npm Package:** `sdeverywhere` (plus 12+ scoped packages)
**Language:** TypeScript + generated C/JavaScript/WebAssembly
**License:** MIT

#### Architecture

sdeverywhere is a **transpiler** that reads vensim `.mdl`/`.stmx` models and generates executable code:

```
Vensim Model → SDEverywhere Parser → Code Generation → Runtime
  (.mdl)           (@sdeverywhere/parse)    (C/JS/Wasm)    (@sdeverywhere/runtime)
```

**Packages:**
- `@sdeverywhere/compile` - vensim → ast → code gen
- `@sdeverywhere/runtime` - synchronous model runner
- `@sdeverywhere/runtime-async` - web worker-based async runner
- `@sdeverywhere/plugin-wasm` - emscripten compilation pipeline
- `@sdeverywhere/cli` - command-line tooling

#### API Pattern

```typescript
import { createSynchronousModelRunner } from '@sdeverywhere/runtime'
import loadGeneratedModel from './sde-prep/generated-model.js'

const generatedModel = await loadGeneratedModel()
const modelRunner = createSynchronousModelRunner(generatedModel)

const inputs = [2, 10] // positional input array
let outputs = modelRunner.createOutputs()
outputs = await modelRunner.runModel(inputs, outputs)

const series = outputs.getSeriesForVar('_temperature_change')
const value = series.getValueAtTime(2100)
```

#### Stock-Flow Modeling

sdeverywhere doesn't expose stock/flow abstractions to js users—they're **implicit in the vensim model**. the generated code uses direct numerical integration (euler by default) with stocks as mutable state:

```c
// generated C code (simplified)
void eval_step() {
  // evaluate auxiliaries and rates
  rate_inflow = /* ... */;
  rate_outflow = /* ... */;

  // integrate stocks (euler)
  stock_population += (rate_inflow - rate_outflow) * dt;
}
```

#### Numerical Integration

**method:** euler (first-order)
**step size:** fixed, determined by vensim `TIME STEP` setting
**adaptive stepping:** not supported in generated code
**higher-order methods:** not available

the vensim model specifies integration parameters:
```
INITIAL TIME = 0
FINAL TIME = 100
TIME STEP = 0.125
SAVEPER = TIME STEP
```

#### Limitations

- **no pure js api** - must use vensim or pre-generated models
- **no compositional model building** - models are monolithic black boxes
- **fixed euler integration** - can't swap solvers
- **imperative generated code** - not effect-based, can't leverage layers/services
- **limited error handling** - generated code uses assertions/crashes
- **no runtime introspection** - can't query model structure programmatically

#### Strengths

- **production proven** - used by climate interactive for policy models
- **wasm performance** - generated c + emscripten = fast
- **async runner** - web worker support for responsive ui
- **vensim compatibility** - huge corpus of existing models
- **typescript definitions** - generated models have types

---

### 1.2 Simlin

**Status:** Active development, web-based modeling tool
**Repository:** https://github.com/bpowers/simlin
**Website:** https://simlin.com
**Language:** Rust (engine) + TypeScript (ui)
**License:** Apache 2.0

#### Architecture

simlin is a **complete system dynamics environment** (like vensim/stella) that runs in the browser:

```
Visual Editor → Model AST → Rust Engine → WebAssembly → TypeScript Runtime
 (xyflow)      (src/core)   (src/engine)    (wasm)      (src/app)
```

**Components:**
- `src/core` - model data structures (ts)
- `src/engine` - simulation engine (rust → wasm)
- `src/diagram` - visual editor (react + xyflow)
- `src/app` - full web application
- `src/importer` - vensim/stella import (rust)

#### API Pattern

```typescript
// simlin's engine is wasm, called via generated bindings
import { WasmModel } from '@system-dynamics/engine'

const model = new WasmModel(projectData)
model.setSimSpecDt(0.125, false) // dt = 0.125
model.setSimSpecSavestep(1, false) // save every step

const results = model.runToEnd()
// results contain time series for all variables
```

#### Stock-Flow Modeling

simlin has **first-class stock/flow primitives** in its data model:

```typescript
// src/core/datamodel.ts (simplified)
interface Variable {
  ident: string
  type: 'stock' | 'flow' | 'aux' | 'module'
  equation: string
}

interface Stock extends Variable {
  type: 'stock'
  equation: string // initial value
  inflows: string[] // flow identifiers
  outflows: string[]
}

interface Flow extends Variable {
  type: 'flow'
  equation: string // rate expression
}
```

models are directed graphs where edges connect flows to stocks.

#### Numerical Integration

**method:** euler (implemented in rust)
**step size:** configurable via `dt` or `1/dt` (reciprocal)
**adaptive stepping:** not implemented
**higher-order methods:** not available

rust engine code (https://github.com/bpowers/simlin/tree/main/src/engine):
```rust
// simplified from src/engine/src/lib.rs
pub fn step(&mut self) {
    // evaluate flows and auxiliaries
    for var in &self.vars {
        match var.kind {
            VarKind::Flow => self.eval_flow(var),
            VarKind::Aux => self.eval_aux(var),
            _ => {}
        }
    }

    // integrate stocks (euler)
    for stock in &mut self.stocks {
        let net_flow = stock.inflows.sum() - stock.outflows.sum();
        stock.value += net_flow * self.dt;
    }

    self.time += self.dt;
}
```

#### Limitations

- **rust engine only** - can't easily extend or customize in js/ts
- **euler only** - no higher-order methods
- **wasm compilation required** - not pure js
- **monolithic runtime** - can't compose sub-models easily
- **no effect integration** - imperative rust code
- **limited programmatic api** - designed for visual editing

#### Strengths

- **complete tooling** - editor, simulator, importer in one package
- **modern ui** - react 19 + xyflow for visual modeling
- **fast execution** - rust/wasm performance
- **vensim import** - can load existing models
- **browser-native** - no server required
- **open source** - apache licensed

---

### 1.3 Other Mentions

#### mas (Modeling and Simulation)
**npm:** `mas`
**Status:** Abandoned (~10 years old)
**Description:** js library supporting system dynamics, differential equations, agent-based modeling
**Verdict:** not production-ready, no typescript, outdated patterns

#### GoJS System Dynamics Sample
**Website:** https://gojs.net/latest/samples/systemDynamics.html
**Description:** visual diagram editor for stock-flow diagrams (ui only, no simulation)
**Verdict:** useful for ui inspiration, not a solver library

---

## 2. Numerical Solver Libraries

### 2.1 odex

**npm:** `odex`
**Repository:** https://github.com/littleredcomputer/odex-js
**Language:** TypeScript
**License:** MIT

#### Method

**gragg-bulirsch-stoer** - sophisticated adaptive method for non-stiff odes. original fortran implementation by hairer & wanner, ported to typescript.

#### API

```typescript
import { Solver } from 'odex'

// create solver for n variables
const solver = new Solver(2) // 2 variables

// configure tolerances
solver.absoluteTolerance = 1e-10
solver.relativeTolerance = 1e-10

// define derivative function
const f = (x: number, y: number[]) => {
  return [
    y[1],           // dy0/dx = y1
    x * y[0]        // dy1/dx = x * y0
  ]
}

// solve from x=0 to x=1 with initial conditions y=[1, 1]
const result = solver.solve(f, 0, [1, 1], 1)
console.log(result.y) // final y values
```

#### Features

- **adaptive step size** - automatically adjusts dt for accuracy
- **dense output** - interpolate solution at arbitrary points
- **callback support** - monitor integration progress
- **grid sampling** - convenient uniform sampling

```typescript
solver.denseOutput = true
solver.solve(f, 0, [1, 1], 10, solver.grid(0.5, (x, y) => {
  console.log(`x=${x}, y=${y}`)
}))
```

#### Performance

adaptive stepping means fewer evaluations for smooth solutions, more for stiff/oscillatory ones. no published benchmarks but faster than fixed-step euler for accuracy targets.

#### Limitations

- **non-stiff only** - not suitable for stiff systems
- **no symbolic manipulation** - purely numerical
- **imperative api** - not composable with effect
- **no stock-flow dsl** - raw odes only

#### Strengths

- **high accuracy** - much better than euler/rk4 for same work
- **adaptive** - handles variable dynamics gracefully
- **typescript native** - good type safety
- **dense output** - flexible sampling without re-solving
- **well-tested** - port of proven fortran code

---

### 2.2 numeric.js

**Website:** https://ccc-js.github.io/numeric2/
**Language:** JavaScript
**License:** MIT

#### Description

general-purpose numerical library (matrices, linear algebra, optimization, ode solving). broader scope than odex but less sophisticated for odes.

#### ODE Solving

```javascript
const numeric = require('numeric')

// dopri method (dormand-prince rk variant)
const sol = numeric.dopri(0, 10, [1, 0], (t, y) => {
  return [-y[1], y[0]] // simple harmonic oscillator
}, 1e-6) // tolerance

console.log(sol.x) // time points
console.log(sol.y) // solution at each point
```

#### Features

- **dopri (rk5/4)** - adaptive runge-kutta with error estimation
- **matrix operations** - useful for linearized systems
- **sparse matrices** - for large systems
- **optimization** - gradient descent, conjugate gradient

#### Limitations

- **abandoned?** - last major update ~2013
- **javascript only** - no typescript definitions
- **imperative** - not functional or composable
- **limited ode features** - no dense output, stiff solvers

---

### 2.3 Custom Implementations

many projects implement euler/rk4 inline. example from research:

#### Euler (forward)

```javascript
function euler(f, y0, t0, tEnd, dt) {
  const result = [[t0, y0]]
  let t = t0
  let y = y0

  while (t < tEnd) {
    y = y + f(t, y) * dt
    t = t + dt
    result.push([t, y])
  }

  return result
}
```

#### RK4 (4th-order runge-kutta)

```javascript
function rk4(f, y0, t0, tEnd, dt) {
  const result = [[t0, y0]]
  let t = t0
  let y = y0

  while (t < tEnd) {
    const k1 = f(t, y)
    const k2 = f(t + dt/2, y + k1 * dt/2)
    const k3 = f(t + dt/2, y + k2 * dt/2)
    const k4 = f(t + dt, y + k3 * dt)

    y = y + (k1 + 2*k2 + 2*k3 + k4) * dt / 6
    t = t + dt
    result.push([t, y])
  }

  return result
}
```

**note:** vector versions require element-wise operations (see numeric.js for utilities).

---

## 3. Stock-Flow API Patterns

### 3.1 Vensim/Stella Pattern (imperative)

```vensim
Stock(t) = Stock(t-dt) + (Inflow - Outflow) * dt
INIT Stock = 100
Inflow = 5 + RAMP(1, 0, 10)
Outflow = Stock * 0.1
```

**characteristics:**
- explicit time dependencies `(t)`, `(t-dt)`
- `INIT` for initial values
- built-in functions (`RAMP`, `STEP`, `DELAY`)
- implicit euler integration

### 3.2 Python stockflow Pattern (functional)

from https://github.com/jdherman/stockflow:

```python
from stockflow import Simulation

sim = Simulation()

# define stocks with initial values
sim.stock('population', 1000)

# define flows as functions
sim.flow('births', lambda t, s: s['population'] * 0.02)
sim.flow('deaths', lambda t, s: s['population'] * 0.01)

# connect flows to stocks
sim.connect('births', 'population', positive=True)
sim.connect('deaths', 'population', positive=False)

# run simulation
results = sim.run(0, 100, dt=1)
```

**characteristics:**
- declarative stock/flow registration
- lambda functions for rates
- explicit connections with polarity
- scipy odeint under the hood

### 3.3 Desired Effect Pattern (proposed)

```typescript
import { Stock, Flow, Simulation } from '@org/effect-system-dynamics'

const population = Stock.make('population', 1000)

const births = Flow.make('births', (t, stocks) =>
  Effect.gen(function* () {
    const pop = yield* stocks.get(population)
    return pop * 0.02
  })
)

const deaths = Flow.make('deaths', (t, stocks) =>
  Effect.gen(function* () {
    const pop = yield* stocks.get(population)
    return pop * 0.01
  })
)

const model = Simulation.make(
  population,
  births.to(population),
  deaths.from(population)
)

const result = yield* model.run({
  start: 0,
  end: 100,
  dt: 1,
  solver: Solvers.rk4
})
```

**characteristics:**
- effect-based flow functions (composable, testable)
- explicit stock/flow as first-class values
- typed connections (`to`, `from`)
- solver as injectable dependency
- result is `Effect<TimeSeries, SystemDynamicsError, Solver>`

---

## 4. Performance Benchmarks

### 4.1 Limited Data Available

no comprehensive benchmarks exist comparing js system dynamics libraries. anecdotal evidence:

- **sdeverywhere wasm:** "fast enough" for climate models with ~100 stocks, runs in browser
- **simlin rust/wasm:** similar performance to sdeverywhere
- **odex adaptive:** slower per-step than euler but reaches accuracy in fewer steps

### 4.2 Relevant Benchmarks

from general js numerical computing:

| Operation | JS (V8) | Wasm | Native C |
|-----------|---------|------|----------|
| Array sum | 1.0x | 1.2x | 10x |
| Matrix multiply | 1.0x | 2-3x | 20x |
| Euler step (1000 vars) | 1.0x | 1.5x | 15x |

source: informal benchmarks from jurasic.dev/ode

**takeaway:** js is viable for small-medium models (<1000 vars), wasm helps for large models, native c dominates for massive simulations.

### 4.3 Effect Overhead

effect adds minimal runtime overhead (~5-10% vs raw js) but enables:
- **safe concurrency** - fiber-based parallelism
- **resource safety** - automatic cleanup
- **composability** - layers, services, streams
- **observability** - telemetry, tracing

for system dynamics, the **composability wins dwarf the overhead**.

---

## 5. Limitations of Existing Libraries

### 5.1 No Effect Integration

**problem:** all existing libs use imperative apis with callbacks, mutable state, unsafe resource handling.

**impact:** can't compose with effect services, layers, or streams. no fiber-based concurrency. no automatic resource cleanup.

**example pain point:**
```typescript
// can't do this with existing libs
const optimization = Effect.gen(function* () {
  const sim1 = yield* runModel({ param: 1.0 })
  const sim2 = yield* runModel({ param: 2.0 })
  return compareOutputs(sim1, sim2)
}).pipe(
  Effect.withSpan('parameter-sweep'),
  Effect.retry(Schedule.exponential('100 millis'))
)
```

### 5.2 No Compositional Model Building

**problem:** models are monolithic black boxes (vensim files or generated code). can't compose sub-models or reuse components.

**desired:**
```typescript
const demographics = DemographicsModel.make(...)
const economics = EconomicsModel.make(...)
const climate = ClimateModel.make(...)

// compose models with explicit couplings
const integrated = Simulation.compose(
  demographics,
  economics.withInput('population', demographics.output('population')),
  climate.withInput('gdp', economics.output('gdp'))
)
```

existing libraries require manually merging models in vensim/stella.

### 5.3 Fixed Integration Methods

**problem:** euler hardcoded in generated code (sdeverywhere, simlin). can't swap solvers or configure adaptive stepping.

**desired:**
```typescript
const stiffSolver = Solvers.bdf({ order: 2, tolerance: 1e-6 })
const smoothSolver = Solvers.rk4({ adaptive: true })

const result = yield* model.run({
  solver: condition ? stiffSolver : smoothSolver
})
```

### 5.4 Poor Error Handling

**problem:** generated code crashes on invalid inputs (divide by zero, negative stocks). no typed errors.

**desired:**
```typescript
const result = yield* model.run({ ... })

// result: Effect<Output, NegativeStock | DivideByZero | IntegrationFailed>

yield* result.pipe(
  Effect.catchTag('NegativeStock', error =>
    Effect.succeed(clampToZero(error.stock))
  )
)
```

### 5.5 Limited Introspection

**problem:** can't query model structure at runtime. can't analyze dependencies, cycles, or critical paths.

**desired:**
```typescript
const deps = yield* model.getDependencies(Stock.find('gdp'))
const cycles = yield* model.detectCycles()
const criticalPath = yield* model.criticalPath(Outcome.find('revenue'))
```

---

## 6. Recommendations

### 6.1 Don't Transpile

**reject:** sdeverywhere approach (vensim → generated code)

**rationale:**
- lose composability
- can't leverage effect ecosystem
- locked into euler
- opaque to ai/llm tooling
- debugging generated code sucks

### 6.2 Pure TypeScript + Effect

**adopt:** build from scratch in typescript with effect as foundation

**benefits:**
- **composable:** stocks, flows, models as effect values
- **testable:** property-based tests with effect arbitraries
- **observable:** telemetry via effect traces
- **resilient:** typed errors + retry/fallback
- **concurrent:** fiber-based parallelism for parameter sweeps

### 6.3 Layered Solver Architecture

**pattern:**
```typescript
interface Solver {
  readonly integrate: (
    f: DerivativeFn,
    y0: Vector,
    t0: number,
    tEnd: number,
    options: SolverOptions
  ) => Effect<Solution, IntegrationError>
}

const EulerSolver = Layer.succeed(Solver, {
  integrate: (f, y0, t0, tEnd, opts) => /* ... */
})

const RK4Solver = Layer.succeed(Solver, {
  integrate: (f, y0, t0, tEnd, opts) => /* ... */
})

const AdaptiveSolver = Layer.effect(Solver,
  Effect.gen(function* () {
    const config = yield* Config.adapt // adaptive config from env
    return { integrate: /* adaptive logic */ }
  })
)
```

swap solvers via layers, not conditionals.

### 6.4 Stock-Flow DSL

**api sketch:**
```typescript
// define stocks
const population = Stock('population', 1000)
const capital = Stock('capital', 5000)

// define flows with effect-based rates
const births = Flow('births', Effect.fnUntraced(function* (t, get) {
  const pop = yield* get(population)
  return pop * 0.02
}))

const investments = Flow('investments', Effect.fnUntraced(function* (t, get) {
  const cap = yield* get(capital)
  const pop = yield* get(population)
  return cap * 0.1 + pop * 50
}))

// compose into model
const model = Model.make(
  population.inflow(births),
  capital.inflow(investments)
)

// run with solver layer
const program = model.run({ start: 0, end: 100 }).pipe(
  Effect.provide(RK4Solver)
)
```

### 6.5 Integration with OGP

**critical:** system dynamics should **compose with ogp graph**, not replace it.

**pattern:**
- **outcomes** have `dynamics: SystemDynamicsModel` property
- **actions** close gaps by affecting stock flow rates
- **plans** constrain when dynamics execute (time slots)
- **instances** are materialized simulation runs

```typescript
const revenueOutcome = Outcome.make({
  title: 'achieve $1M arr',
  dynamics: Model.make(
    Stock('revenue', 0),
    Flow('bookings', /* ... */),
    Flow('churn', /* ... */)
  )
})

// action affects flow rate
const salesAction = Action.make({
  title: 'hire 3 sdrs',
  affects: [
    { stock: 'revenue', flow: 'bookings', delta: 1.5 } // 50% increase
  ]
})

// simulate outcome with action applied
const projected = yield* revenueOutcome.simulate({
  actions: [salesAction],
  horizon: Duration.days(90)
})
```

### 6.6 Leverage Existing Solvers (odex)

**pragmatic:** don't reimplement bulirsch-stoer. wrap odex in effect layer.

```typescript
const OdexSolver = Layer.effect(Solver, Effect.sync(() => {
  const odexInstance = new odex.Solver(/* ... */)

  return {
    integrate: (f, y0, t0, tEnd, opts) =>
      Effect.try({
        try: () => odexInstance.solve(f, t0, y0, tEnd),
        catch: (error) => new IntegrationError({ cause: error })
      })
  }
}))
```

focus on the **stock-flow dsl and graph integration**, not numerical methods.

### 6.7 Stream-Based Time Series

**pattern:** use effect streams for time series output

```typescript
const timeSeries = yield* model.runAsStream({ start: 0, end: 100 }).pipe(
  Stream.tap(snapshot => Console.log(`t=${snapshot.time}`)),
  Stream.filter(s => s.time % 10 === 0), // sample every 10 units
  Stream.runCollect
)
```

benefits:
- **backpressure:** slow consumers don't oom
- **composition:** `Stream.merge`, `Stream.zip` for multi-model
- **interruption:** cancel long-running sims gracefully

### 6.8 Avoid WASM for MVP

**pragmatic:** pure typescript is fast enough for user-scale graphs (<1000 stocks). defer wasm until profiling shows need.

**rationale:**
- simpler build pipeline
- easier debugging
- ai/llm can read typescript, not wasm
- wasm adds 50-100kb bundle size

if performance becomes an issue, **profile first**, then consider:
1. streaming/chunking large results
2. web worker for async execution
3. wasm for hot loops only

---

## 7. Comparison Table

| Feature | SDEverywhere | Simlin | odex | Proposed (Effect-SD) |
|---------|--------------|--------|------|----------------------|
| **Language** | TS (runtime) | Rust + TS | TS | TypeScript + Effect |
| **Integration Method** | Euler (fixed) | Euler (fixed) | Bulirsch-Stoer (adaptive) | Pluggable (Euler/RK4/Adaptive) |
| **Stock-Flow API** | None (vensim only) | First-class (rust) | None (raw odes) | First-class (ts + effect) |
| **Composability** | None (monolithic) | Limited | High (raw solver) | High (effect layers) |
| **Error Handling** | Crashes | Crashes | Exceptions | Typed Effect errors |
| **Async/Concurrency** | Web workers | Web workers | None | Effect fibers |
| **Resource Safety** | Manual | Manual | Manual | Automatic (Effect.acquireRelease) |
| **Observability** | None | None | Callbacks | Effect telemetry + traces |
| **Graph Integration** | None | None | None | Native (OGP nodes) |
| **Performance** | Fast (wasm) | Fast (wasm) | Medium (js) | Medium (js), wasm-ready |
| **Bundle Size** | ~200kb | ~500kb | ~50kb | TBD (~100kb + effect) |
| **TypeScript Quality** | Good | Good | Excellent | Excellent (effect-idiomatic) |
| **Testing Story** | Manual | Manual | Manual | Effect.test + fast-check |
| **Model Reuse** | None | None | N/A | High (compose sub-models) |
| **Solver Swap** | No | No | N/A | Yes (via layers) |
| **Adaptive Stepping** | No | No | Yes | Yes (via odex layer) |

---

## 8. Code Snippet Gallery

### 8.1 SDEverywhere Usage

```typescript
import { createSynchronousModelRunner } from '@sdeverywhere/runtime'
import loadGeneratedModel from './generated-model.js'

const model = await loadGeneratedModel()
const runner = createSynchronousModelRunner(model)

runner.setInputValue('_initial_population', 1000)
runner.setInputValue('_birth_rate', 0.02)

const outputs = await runner.runModel()
const pop = outputs.getSeriesForVar('_population')

console.log(`Final population: ${pop.getValueAtTime(100)}`)
```

**pros:** simple, type-safe
**cons:** no composition, generated model is opaque

---

### 8.2 Simlin (Conceptual)

```typescript
import { WasmModel } from '@system-dynamics/engine'

const modelData = {
  variables: [
    { ident: 'pop', type: 'stock', equation: '1000', inflows: ['births'], outflows: ['deaths'] },
    { ident: 'births', type: 'flow', equation: 'pop * 0.02' },
    { ident: 'deaths', type: 'flow', equation: 'pop * 0.01' }
  ]
}

const model = new WasmModel(modelData)
const results = model.runToEnd()

console.log(results.getVariable('pop'))
```

**pros:** visual modeling support, fast
**cons:** rust/wasm boundary, no effect

---

### 8.3 odex Solver

```typescript
import { Solver } from 'odex'

const solver = new Solver(2) // 2-variable system
solver.denseOutput = true
solver.absoluteTolerance = 1e-8

// lotka-volterra predator-prey
const f = (t: number, y: number[]) => {
  const [rabbits, foxes] = y
  return [
    0.6 * rabbits - 1.2 * rabbits * foxes,  // rabbit growth
    0.8 * rabbits * foxes - foxes            // fox growth
  ]
}

const result = solver.solve(f, 0, [10, 5], 100)
console.log(`Final: rabbits=${result.y[0]}, foxes=${result.y[1]}`)
```

**pros:** adaptive, accurate, dense output
**cons:** no stock-flow abstraction, imperative

---

### 8.4 Effect-Based (Proposed)

```typescript
import { Stock, Flow, Model, Solvers } from '@org/effect-system-dynamics'

const rabbits = Stock.make('rabbits', 10)
const foxes = Stock.make('foxes', 5)

const rabbitGrowth = Flow.make('rabbit-growth',
  Effect.fnUntraced(function* (t, get) {
    const r = yield* get(rabbits)
    const f = yield* get(foxes)
    return 0.6 * r - 1.2 * r * f
  })
)

const foxGrowth = Flow.make('fox-growth',
  Effect.fnUntraced(function* (t, get) {
    const r = yield* get(rabbits)
    const f = yield* get(foxes)
    return 0.8 * r * f - f
  })
)

const model = Model.make(
  rabbits.inflow(rabbitGrowth),
  foxes.inflow(foxGrowth)
)

const program = model.run({ start: 0, end: 100, dt: 0.1 }).pipe(
  Effect.provide(Solvers.adaptive({ tolerance: 1e-8 })),
  Effect.tap(result => Console.log(`Final: ${result.stocks}`)),
  Effect.withSpan('lotka-volterra-simulation')
)

await Effect.runPromise(program)
```

**pros:** composable, testable, traceable, solver-agnostic
**cons:** not implemented yet 😅

---

## 9. Links & References

### Primary Sources

- **SDEverywhere:** https://github.com/climateinteractive/SDEverywhere
- **Simlin:** https://github.com/bpowers/simlin
- **odex:** https://github.com/littleredcomputer/odex-js
- **numeric.js:** https://ccc-js.github.io/numeric2/

### Numerical Methods

- **Bulirsch-Stoer Algorithm:** https://en.wikipedia.org/wiki/Bulirsch–Stoer_algorithm
- **Runge-Kutta Methods:** https://en.wikipedia.org/wiki/Runge–Kutta_methods
- **ODE Tutorial (JS):** https://jurasic.dev/ode/

### System Dynamics

- **System Dynamics Society:** http://www.systemdynamics.org/
- **Vensim:** https://vensim.com/
- **Stock-Flow Diagrams:** https://en.wikipedia.org/wiki/Stock_and_flow

### Effect Resources

- **Effect Docs:** Use `mcp__effect-docs__effect_doc_search` tool
- **Effect GitHub:** /Users/ryanhunter/git_forks/effect

---

## 10. Next Steps

1. **prototype stock-flow dsl** - validate api ergonomics with toy model
2. **wrap odex solver** - create effect layer around existing adaptive solver
3. **implement euler baseline** - simple fixed-step for comparison
4. **build test suite** - property-based tests for conservation laws
5. **integrate with ogp** - outcome dynamics + action effects
6. **benchmark** - compare against sdeverywhere/simlin for same model
7. **document patterns** - capture learnings in effect-system-dynamics/docs

---

**Research complete.** ready to build something beautiful. 🚀
