# @org/effect-system-dynamics

Effect-idiomatic system dynamics toolkit for composing, simulating, and analysing stock–flow models with Effect services and streams.

## Installation

```bash
pnpm add @org/effect-system-dynamics effect
```

## Quickstart

```typescript
import { Effect, Layer, Schema, Stream } from "effect"
import {
  Model,
  ModelId,
  SimState,
  Solver,
  Stock,
  StockId,
  TimeConfig,
  simulate,
  simulateFinal
} from "@org/effect-system-dynamics"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)

const population = new Stock({
  id: decodeStockId("550e8400-e29b-41d4-a716-446655440000"),
  name: "Population",
  initialValue: 1_000
})

const model = new Model({
  id: decodeModelId("660e8400-e29b-41d4-a716-446655440001"),
  name: "Population Growth",
  stocks: [population],
  flows: [],
  variables: [],
  timeConfig: new TimeConfig({ start: 0, end: 10, step: 0.5 })
})

const program = Effect.gen(function* () {
  const stream = yield* simulate(model)

  yield* Stream.runForEach(stream, (state) =>
    Effect.log(`t=${state.time.toFixed(1)} → population=${state.stocks[population.id]}`)
  )

  const finalState = yield* simulateFinal(model)
  yield* Effect.log(`final population = ${finalState.stocks[population.id]}`)
}).pipe(Effect.provide(Solver.Euler))

await Effect.runPromise(program)
```

## API Overview

| Module | Highlights |
| --- | --- |
| `Types` | Branded identifiers (`StockId`, `FlowId`, `ModelId`) with schema-safe decoding. |
| `Model` | Schema classes for `Stock`, `Flow`, `Variable`, `TimeConfig`, and `Model`. |
| `Simulation` | Lazy `simulate`, eager helpers, and `SimState` snapshots with unit metadata. |
| `Solver` | `Context.Tag` with pluggable solver layers (`Solver.Euler`, `Solver.RK4`) enforcing dimensional consistency. |
| `Errors` | Tagged solver error hierarchy (`ConvergenceError`, `InvalidTimeStepError`, `EquationEvaluationError`). |
| `Units` | Schema-backed unit registry with explicit conversion helpers (never applied automatically). |
| `Scenarios` | Scenario branching, sensitivity analysis, and grid-search optimisation utilities. |

## Units & Dimensional Analysis

- Every stock may declare units (plain strings such as `"kg"`, `"people"`, or composite forms like `"kg · m"`).
- Flows must evaluate to **stock ÷ time**; if a flow connects two stocks, both must share the same units.
- `SimState.units` captures the inferred unit map for stocks, flow rates, variables, and simulation time at each timestep.
- The engine performs *no* automatic conversions—explicitly normalise units inside your equations when you need cross-unit interactions.

```typescript
const raw = new Stock({
  id: decodeStockId("b60e8400-e29b-41d4-a716-446655440001"),
  name: "RawMaterials",
  initialValue: 100,
  units: "kg"
})

const finished = new Stock({
  id: decodeStockId("c70e8400-e29b-41d4-a716-446655440002"),
  name: "FinishedGoods",
  initialValue: 0,
  units: "kg"
})

const processing = new Flow({
  id: decodeFlowId("d80e8400-e29b-41d4-a716-446655440003"),
  name: "Processing",
  source: raw.id,
  target: finished.id,
  rateEquation: "[RawMaterials] / { 5 tick }",
  units: "kg per tick"
})

const model = new Model({
  id: decodeModelId("f10e8400-e29b-41d4-a716-446655440005"),
  name: "ManufacturingPipeline",
  stocks: [raw, finished],
  flows: [processing],
  variables: [],
  timeConfig: new TimeConfig({ start: 0, end: 10, step: 1 })
})

const states = await Effect.runPromise(
  simulateEager(model).pipe(Effect.provide(Solver.Euler))
)

console.log(states[0].units.rates[raw.id])
// => { kg: 1, tick: -1 }
```

> ℹ️ Need to mix units? Convert explicitly inside the equation (e.g. divide by `"{ 24 hour }"`) so the solver continues to fail fast on accidental mismatches.

To convert values explicitly, opt into the `Units` module:

```typescript
import { Effect, Schema } from "effect"
import {
  UnitDefinition,
  makeRegistry,
  convertValue,
} from "@org/effect-system-dynamics/Units"

const decodeUnit = Schema.decodeSync(UnitDefinition)

const registry = makeRegistry([
  decodeUnit({ symbol: "kg", dimension: { mass: 1 }, factor: 1 }),
  decodeUnit({ symbol: "g", dimension: { mass: 1 }, factor: 0.001 })
])

const kilograms = await Effect.runPromise(convertValue(registry, 5000, "g", "kg"))
console.log(kilograms) // => 5
```

## Scenarios & Analysis

```typescript
import { Effect, Schema } from "effect"
import {
  ScenarioDefinition,
  ScenarioService,
  SensitivityService,
  OptimizerService,
  Objective,
  Constraint,
} from "@org/effect-system-dynamics/Scenarios"
import { ScenarioId } from "@org/effect-system-dynamics/Types"

const decodeScenarioId = Schema.decodeSync(ScenarioId)

const scenario = new ScenarioDefinition({
  id: decodeScenarioId("990e8400-e29b-41d4-a716-446655440000"),
  name: "High Growth",
  baseModelId: model.id,
  overrides: { GrowthRate: 0.15 },
})

const program = Effect.gen(function* () {
  const scenarioService = yield* ScenarioService
  const sensitivity = yield* SensitivityService
  const optimizer = yield* OptimizerService

  const comparison = yield* scenarioService.compare(model, [scenario])
  const leverage = yield* sensitivity.analyze(model, "Population", ["GrowthRate"], 10)
  const optimum = yield* optimizer.optimize(
    model,
    new Objective({ target: "Population", direction: "maximize", atTime: 10 }),
    [new Constraint({ parameter: "GrowthRate", min: 0.05, max: 0.15 })],
    { stepsPerParameter: 5 },
  )

  return { comparison, leverage, optimum }
}).pipe(
  Effect.provide(OptimizerService.layer),
  Effect.provide(SensitivityService.layer),
  Effect.provide(ScenarioService.layer),
  Effect.provide(Solver.Euler),
  Effect.provide(EquationEvaluator.layer),
)

await Effect.runPromise(program)
```

## Solver Comparison

| Solver | Order | Characteristics | Status |
| --- | --- | --- | --- |
| `Solver.Euler` | 1st | Fast baseline for prototyping; one rate evaluation per step. | ✅ Implemented |
| `Solver.RK4` | 4th (stub) | Placeholder delegating to Euler while the real RK4 evaluator lands. | ⚠️ Stub (delegates to Euler) |

## Documentation

- [Architecture](./docs/ARCHITECTURE-FINAL.md)
- [Atomic PR Roadmap](./docs/ATOMIC-PRS.md)

## License

MIT
