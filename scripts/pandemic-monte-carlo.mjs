import { Schema, Effect, Layer } from "effect"
import { Solver } from "../build/src/Solver.js"
import { EquationEvaluator } from "../build/src/Equations.js"
import { UnitManager } from "../build/src/Units.js"
import { Model, Stock, Flow, Variable, TimeConfig } from "../build/src/Model.js"
import { ModelId, StockId, FlowId, VariableId, ScenarioId } from "../build/src/Types.js"
import { ScenarioDefinition, ScenarioService, ScenarioServicesLayer } from "../build/src/Scenarios.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)
const decodeScenarioId = Schema.decodeSync(ScenarioId)

const population = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000001"),
  name: "Population",
  equation: "1000000",
  type: "constant",
  value: 1000000,
})

const transmissionScale = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000002"),
  name: "TransmissionScale",
  equation: "1",
  type: "constant",
  value: 1,
})

const baseContact = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000003"),
  name: "BaseContact",
  equation: "LOOKUP([TimeScaled], (0, 0.35) (30, 0.55) (60, 0.25) (90, 0.45) (120, 0.3))",
  type: "auxiliary",
})

const timeScaled = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000011"),
  name: "TimeScaled",
  equation: "[Time] / { 1 tick }",
  type: "auxiliary",
})

const effectiveTransmission = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000004"),
  name: "EffectiveTransmission",
  equation: "[BaseContact] * [TransmissionScale]",
  type: "auxiliary",
})

const recoveryRate = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000005"),
  name: "RecoveryRate",
  equation: "0.1",
  type: "constant",
  value: 0.1,
})

const hospitalizationRate = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000006"),
  name: "HospitalizationRate",
  equation: "0.04",
  type: "constant",
  value: 0.04,
})

const hospitalizationScale = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000007"),
  name: "HospitalizationScale",
  equation: "1",
  type: "constant",
  value: 1,
})

const hospitalStay = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000008"),
  name: "HospitalStay",
  equation: "10",
  type: "constant",
  value: 10,
})

const hospitalStayInverse = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000009"),
  name: "HospitalStayInverse",
  equation: "1 / [HospitalStay]",
  type: "auxiliary",
})

const vaccinationRate = new Variable({
  id: decodeVariableId("11000000-0000-4000-8000-000000000010"),
  name: "VaccinationRate",
  equation: "IF [Time] >= { 30 tick } THEN 5000 ELSE 0 END IF",
  type: "auxiliary",
})

const susceptible = new Stock({
  id: decodeStockId("12000000-0000-4000-8000-000000000001"),
  name: "Susceptible",
  initialValue: 999000,
})

const infected = new Stock({
  id: decodeStockId("12000000-0000-4000-8000-000000000002"),
  name: "Infected",
  initialValue: 1000,
})

const recovered = new Stock({
  id: decodeStockId("12000000-0000-4000-8000-000000000003"),
  name: "Recovered",
  initialValue: 0,
})

const hospitalized = new Stock({
  id: decodeStockId("12000000-0000-4000-8000-000000000004"),
  name: "Hospitalized",
  initialValue: 0,
})

const infectionFlow = new Flow({
  id: decodeFlowId("13000000-0000-4000-8000-000000000001"),
  name: "Infections",
  source: susceptible.id,
  target: infected.id,
  rateEquation: "([Susceptible] * [Infected] * [EffectiveTransmission] / [Population]) / { 1 tick }",
})

const recoveryFlow = new Flow({
  id: decodeFlowId("13000000-0000-4000-8000-000000000002"),
  name: "Recoveries",
  source: infected.id,
  target: recovered.id,
  rateEquation: "[Infected] * [RecoveryRate] / { 1 tick }",
})

const hospitalizationFlow = new Flow({
  id: decodeFlowId("13000000-0000-4000-8000-000000000003"),
  name: "HospitalAdmissions",
  source: infected.id,
  target: hospitalized.id,
  rateEquation: "[Infected] * [HospitalizationRate] * [HospitalizationScale] / { 1 tick }",
})

const hospitalRecoveryFlow = new Flow({
  id: decodeFlowId("13000000-0000-4000-8000-000000000004"),
  name: "HospitalDischarges",
  source: hospitalized.id,
  target: recovered.id,
  rateEquation: "[Hospitalized] * [HospitalStayInverse] / { 1 tick }",
})

const vaccinationFlow = new Flow({
  id: decodeFlowId("13000000-0000-4000-8000-000000000005"),
  name: "Vaccinations",
  source: susceptible.id,
  target: recovered.id,
  rateEquation: "[VaccinationRate] / { 1 tick }",
})

const model = new Model({
  id: decodeModelId("14000000-0000-4000-8000-000000000001"),
  name: "Pandemic Response",
  stocks: [susceptible, infected, recovered, hospitalized],
  flows: [infectionFlow, recoveryFlow, hospitalizationFlow, hospitalRecoveryFlow, vaccinationFlow],
  variables: [
    population,
    transmissionScale,
    baseContact,
    timeScaled,
    effectiveTransmission,
    recoveryRate,
    hospitalizationRate,
    hospitalizationScale,
    hospitalStay,
    hospitalStayInverse,
    vaccinationRate,
  ],
  timeConfig: new TimeConfig({ start: 0, end: 120, step: 0.5 }),
})

const baseScenario = new ScenarioDefinition({
  id: decodeScenarioId("15000000-0000-4000-8000-000000000001"),
  name: "Baseline",
  baseModelId: model.id,
  overrides: {},
})

const environment = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.RK4, ScenarioServicesLayer)

const options = {
  iterations: 80,
  metrics: ["Infected", "Hospitalized"],
  parameters: [
    {
      name: "TransmissionScale",
      sampler: ({ baseline, random }) => baseline * (0.8 + random() * 0.6),
    },
    {
      name: "HospitalizationRate",
      sampler: ({ baseline, random }) => baseline * (0.7 + random() * 0.6),
    },
  ],
  seed: 20251031,
}

const program = Effect.gen(function* () {
  const service = yield* ScenarioService
  const result = yield* service.monteCarlo(model, baseScenario, options)
  return {
    iterations: result.iterations,
    metrics: result.metrics.map((metric) => ({
      name: metric.name,
      mean: metric.mean,
      variance: metric.variance,
      min: metric.min,
      max: metric.max,
      percentiles: metric.percentiles.map((entry) => ({
        percentile: entry.percentile,
        value: entry.value,
      })),
    })),
  }
}).pipe(Effect.tap((output) => Effect.sync(() => console.log(JSON.stringify(output, null, 2)))))

Effect.runPromise(program.pipe(Effect.provide(environment))).catch((error) => {
  console.error(error)
  process.exit(1)
})
