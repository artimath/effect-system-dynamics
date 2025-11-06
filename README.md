# effect-system-dynamics

Functional system dynamics modeling and simulation built on Effect streams and services.

[![npm version](https://img.shields.io/npm/v/effect-system-dynamics.svg)](https://www.npmjs.com/package/effect-system-dynamics)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/artimath/effect-system-dynamics/blob/master/LICENSE)

## Installation

```bash
pnpm add effect-system-dynamics effect
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

## Validation: Classic SIR Epidemic Model

The package has been validated against published results from the classic SIR (Susceptible-Infected-Recovered) epidemic model:

```typescript
import { Effect, Layer } from "effect";
import { Model, Stock, Flow, TimeConfig, simulate, Solver } from "effect-system-dynamics";
import { UnitDefinition, UnitManager } from "effect-system-dynamics/Units";

// Classic SIR model parameters from Harko et al. (2014)
// β (infection rate) = 0.01, γ (recovery rate) = 0.02
// Initial: S(0)=20, I(0)=15, R(0)=10, N=45

const model = new Model({
  id: /* ... */,
  name: "SIR Epidemic Model",
  stocks: [
    new Stock({ name: "Susceptible", initialValue: 20, units: "people" }),
    new Stock({ name: "Infected", initialValue: 15, units: "people" }),
    new Stock({ name: "Recovered", initialValue: 10, units: "people" })
  ],
  flows: [
    // dS/dt = -β*S*I
    new Flow({
      name: "Infection",
      source: susceptibleId,
      rateEquation: "0.01 * ([Susceptible] / { 1 people }) * [Infected] / { 1 tick }"
    }),
    // dI/dt = β*S*I - γ*I
    new Flow({
      name: "NewInfections",
      target: infectedId,
      rateEquation: "0.01 * ([Susceptible] / { 1 people }) * [Infected] / { 1 tick }"
    }),
    new Flow({
      name: "Recovery",
      source: infectedId,
      target: recoveredId,
      rateEquation: "0.02 * [Infected] / { 1 tick }"
    })
  ],
  timeConfig: new TimeConfig({ start: 0, end: 200, step: 1 })
});

// Results match published analytical solution:
// ✓ Population conservation: 0.000000 variation
// ✓ Epidemic curve: Peak at t=10 with I=28.38
// ✓ R₀ = β/γ = 0.5 < 1 (epidemic dies out naturally)
```

See [test/sir-model.test.ts](./test/sir-model.test.ts) for the complete validated implementation.

## Solver Comparison

| Solver | Order | Characteristics | Status |
| --- | --- | --- | --- |
| `Solver.Euler` | 1st | Fast baseline for prototyping; one rate evaluation per step. | ✅ Implemented |
| `Solver.RK4` | 4th | Classic Runge-Kutta method with four evaluations per step for improved accuracy. | ✅ Implemented |
| `Solver.Adaptive` | Variable | Adaptive step-size control for challenging dynamics. | ✅ Implemented |

## Documentation

- [Architecture](./docs/ARCHITECTURE-FINAL.md)
- [Atomic PR Roadmap](./docs/ATOMIC-PRS.md)

## Examples

- [Predator-Prey (Lotka-Volterra)](./examples/predator-prey-model.ts)
- [SIR Epidemic Model](./test/sir-model.test.ts) - Validated against published results
- [Economic Impact Model](./test/economic-model.test.ts) - Multi-variable business simulation

## License

Apache-2.0

## Author

Ryan Hunter ([@artimath](https://github.com/artimath))
