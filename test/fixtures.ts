import { Schema } from "effect"
import { Flow, Model, Stock, TimeConfig, Variable } from "../src/Model.js"
import { ModelId, FlowId, StockId, VariableId } from "../src/Types.js"

const decodeModelId = Schema.decodeSync(ModelId)
const decodeFlowId = Schema.decodeSync(FlowId)
const decodeStockId = Schema.decodeSync(StockId)
const decodeVariableId = Schema.decodeSync(VariableId)

/**
 * Baseline exponential growth model suitable for quick smoke tests.
 */
export const makePopulationModel = (): Model => {
  const population = new Stock({
    id: decodeStockId("550e8400-e29b-41d4-a716-446655440000"),
    name: "Population",
    initialValue: 1_000
  })

  const growthRate = new Variable({
    id: decodeVariableId("660e8400-e29b-41d4-a716-446655440001"),
    name: "Growth Rate",
    equation: "0.02",
    type: "constant",
    value: 0.02
  })

  const growth = new Flow({
    id: decodeFlowId("770e8400-e29b-41d4-a716-446655440002"),
    name: "Growth",
    target: population.id,
    rateEquation: "[Population] * [Growth Rate]"
  })

  return new Model({
    id: decodeModelId("880e8400-e29b-41d4-a716-446655440003"),
    name: "Population Growth",
    stocks: [population],
    flows: [growth],
    variables: [growthRate],
    timeConfig: new TimeConfig({ start: 0, end: 100, step: 1 })
  })
}

/**
 * SIR infectious disease model with simple beta/gamma parameters.
 */
export const makeSIRModel = (): Model => {
  const susceptible = new Stock({
    id: decodeStockId("990e8400-e29b-41d4-a716-446655440004"),
    name: "Susceptible",
    initialValue: 9_900
  })

  const infected = new Stock({
    id: decodeStockId("aa0e8400-e29b-41d4-a716-446655440005"),
    name: "Infected",
    initialValue: 100
  })

  const recovered = new Stock({
    id: decodeStockId("bb0e8400-e29b-41d4-a716-446655440006"),
    name: "Recovered",
    initialValue: 0
  })

  const beta = new Variable({
    id: decodeVariableId("cc0e8400-e29b-41d4-a716-446655440007"),
    name: "Beta",
    equation: "0.3",
    type: "constant",
    value: 0.3
  })

  const gamma = new Variable({
    id: decodeVariableId("dd0e8400-e29b-41d4-a716-446655440008"),
    name: "Gamma",
    equation: "0.1",
    type: "constant",
    value: 0.1
  })

  const infection = new Flow({
    id: decodeFlowId("ee0e8400-e29b-41d4-a716-446655440009"),
    name: "Infection",
    source: susceptible.id,
    target: infected.id,
    rateEquation: "[Beta] * [Susceptible] * [Infected] / 10000"
  })

  const recovery = new Flow({
    id: decodeFlowId("ff0e8400-e29b-41d4-a716-44665544000a"),
    name: "Recovery",
    source: infected.id,
    target: recovered.id,
    rateEquation: "[Gamma] * [Infected]"
  })

  return new Model({
    id: decodeModelId("110e8400-e29b-41d4-a716-44665544000b"),
    name: "SIR Epidemic",
    stocks: [susceptible, infected, recovered],
    flows: [infection, recovery],
    variables: [beta, gamma],
    timeConfig: new TimeConfig({ start: 0, end: 160, step: 1 })
  })
}

/**
 * Predator–prey Lotka–Volterra style ecosystem model.
 */
export const makePredatorPreyModel = (): Model => {
  const prey = new Stock({
    id: decodeStockId("220e8400-e29b-41d4-a716-44665544000c"),
    name: "Rabbits",
    initialValue: 40
  })

  const predators = new Stock({
    id: decodeStockId("330e8400-e29b-41d4-a716-44665544000d"),
    name: "Foxes",
    initialValue: 9
  })

  const preyBirth = new Flow({
    id: decodeFlowId("440e8400-e29b-41d4-a716-44665544000e"),
    name: "Prey Birth",
    target: prey.id,
    rateEquation: "0.5 * [Rabbits]"
  })

  const predation = new Flow({
    id: decodeFlowId("550e8400-e29b-41d4-a716-44665544000f"),
    name: "Predation",
    source: prey.id,
    target: predators.id,
    rateEquation: "0.02 * [Rabbits] * [Foxes]"
  })

  const predatorDeath = new Flow({
    id: decodeFlowId("660e8400-e29b-41d4-a716-446655440010"),
    name: "Predator Death",
    source: predators.id,
    rateEquation: "0.4 * [Foxes]"
  })

  return new Model({
    id: decodeModelId("770e8400-e29b-41d4-a716-446655440011"),
    name: "Predator Prey",
    stocks: [prey, predators],
    flows: [preyBirth, predation, predatorDeath],
    variables: [],
    timeConfig: new TimeConfig({ start: 0, end: 200, step: 0.5 })
  })
}
