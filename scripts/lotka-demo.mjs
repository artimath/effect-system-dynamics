import { Schema, Effect, Layer } from "effect"
import { simulateEager } from "../build/src/Simulation.js"
import { Solver } from "../build/src/Solver.js"
import { EquationEvaluator } from "../build/src/Equations.js"
import { UnitManager } from "../build/src/Units.js"
import { Model, Stock, Flow, Variable, TimeConfig } from "../build/src/Model.js"
import { ModelId, StockId, FlowId, VariableId } from "../build/src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeVariableId = Schema.decodeSync(VariableId)

const preyBirthRate = new Variable({
  id: decodeVariableId("01000000-0000-4000-8000-000000000001"),
  name: "PreyBirthRate",
  equation: "0.1",
  type: "auxiliary",
})

const predationRate = new Variable({
  id: decodeVariableId("01000000-0000-4000-8000-000000000002"),
  name: "PredationRate",
  equation: "0.01",
  type: "auxiliary",
})

const predatorEfficiency = new Variable({
  id: decodeVariableId("01000000-0000-4000-8000-000000000003"),
  name: "PredatorEfficiency",
  equation: "0.01",
  type: "auxiliary",
})

const predatorDeathRate = new Variable({
  id: decodeVariableId("01000000-0000-4000-8000-000000000004"),
  name: "PredatorDeathRate",
  equation: "0.1",
  type: "constant",
  value: 0.1,
})

const preyStock = new Stock({
  id: decodeStockId("02000000-0000-4000-8000-000000000001"),
  name: "Prey",
  initialValue: 40,
})

const predatorStock = new Stock({
  id: decodeStockId("02000000-0000-4000-8000-000000000002"),
  name: "Predators",
  initialValue: 9,
})

const preyBirthFlow = new Flow({
  id: decodeFlowId("03000000-0000-4000-8000-000000000001"),
  name: "PreyBirth",
  target: preyStock.id,
  rateEquation: "[Prey] * [PreyBirthRate] / { 1 tick }",
})

const predationFlow = new Flow({
  id: decodeFlowId("03000000-0000-4000-8000-000000000002"),
  name: "Predation",
  source: preyStock.id,
  rateEquation: "[Prey] * [PredationRate] * [Predators] / { 1 tick }",
})

const predatorGrowthFlow = new Flow({
  id: decodeFlowId("03000000-0000-4000-8000-000000000003"),
  name: "PredatorGrowth",
  target: predatorStock.id,
  rateEquation: "[Prey] * [PredationRate] * [Predators] * [PredatorEfficiency] / { 1 tick }",
})

const predatorDeathFlow = new Flow({
  id: decodeFlowId("03000000-0000-4000-8000-000000000004"),
  name: "PredatorDeath",
  source: predatorStock.id,
  rateEquation: "[Predators] * [PredatorDeathRate] / { 1 tick }",
})

const model = new Model({
  id: decodeModelId("04000000-0000-4000-8000-000000000001"),
  name: "Lotka-Volterra Predator-Prey",
  stocks: [preyStock, predatorStock],
  flows: [preyBirthFlow, predationFlow, predatorGrowthFlow, predatorDeathFlow],
  variables: [preyBirthRate, predationRate, predatorEfficiency, predatorDeathRate],
  timeConfig: new TimeConfig({ start: 0, end: 50, step: 0.25 }),
})

const layer = Layer.mergeAll(UnitManager.layer(), EquationEvaluator.layer, Solver.RK4)

const main = Effect.gen(function* () {
  const states = yield* simulateEager(model)

  const samples = states.filter((_, index) => index % 10 === 0).map((state) => ({
    time: state.time,
    prey: state.stocks[preyStock.id] ?? 0,
    predators: state.stocks[predatorStock.id] ?? 0,
  }))

  const summary = {
    totalSteps: states.length,
    preyMin: Math.min(...states.map((s) => s.stocks[preyStock.id] ?? 0)),
    preyMax: Math.max(...states.map((s) => s.stocks[preyStock.id] ?? 0)),
    predatorMin: Math.min(...states.map((s) => s.stocks[predatorStock.id] ?? 0)),
    predatorMax: Math.max(...states.map((s) => s.stocks[predatorStock.id] ?? 0)),
  }

  console.log(JSON.stringify({ samples, summary }, null, 2))
})

Effect.runPromise(main.pipe(Effect.provide(layer))).catch((error) => {
  console.error(error)
  process.exit(1)
})
