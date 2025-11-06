import { Effect, Layer } from "effect"
import { simulateEager } from "../src/Simulation.js"
import { Solver } from "../src/Solver.js"
import { EquationEvaluator } from "../src/Equations.js"
import { UnitManager } from "../src/Units.js"
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { buildPredatorPreyModel } from "./predator-prey-model.js"

const predatorPreyModel = buildPredatorPreyModel()

const layer = Layer.mergeAll(
  UnitManager.layer(),
  EquationEvaluator.layer,
  Solver.RK4,
)

const program = Effect.gen(function* () {
  const states = yield* simulateEager(predatorPreyModel)
  return { states }
}).pipe(Effect.provide(layer))

const outDir = resolve("packages/effect-system-dynamics/examples/out")
const modelPath = resolve(outDir, "predator-prey-model.json")
const statesPath = resolve(outDir, "predator-prey-simulation.json")

const ensureDir = Effect.sync(() => mkdirSync(outDir, { recursive: true }))

const writeOutputs = Effect.gen(function* () {
  yield* ensureDir
  const { states } = yield* program

  const modelJson = JSON.stringify(predatorPreyModel, null, 2)
  const statesJson = JSON.stringify(states, null, 2)

  yield* Effect.sync(() => writeFileSync(modelPath, modelJson, "utf-8"))
  yield* Effect.sync(() => writeFileSync(statesPath, statesJson, "utf-8"))
})

Effect.runPromise(writeOutputs).catch((error) => {
  console.error("Failed to generate predator-prey example", error)
  process.exitCode = 1
})
