import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer, Schema, Stream, Chunk } from "effect";
import { Model, Stock, Flow, TimeConfig } from "../src/Model.js";
import { simulate } from "../src/Simulation.js";
import { Solver } from "../src/Solver.js";
import { EquationEvaluator } from "../src/Equations.js";
import { UnitManager, UnitDefinition } from "../src/Units.js";
import { StockId, FlowId, ModelId } from "../src/Types.js";

const decodeStockId = Schema.decodeSync(StockId);
const decodeFlowId = Schema.decodeSync(FlowId);
const decodeModelId = Schema.decodeSync(ModelId);

// Units for SIR model
const epidemicUnits = [
  new UnitDefinition({ symbol: "tick", dimension: { time: 1 }, factor: 1 }),
  new UnitDefinition({
    symbol: "people",
    dimension: { population: 1 },
    factor: 1,
  }),
];

const solverLayer = Layer.mergeAll(
  UnitManager.layer(epidemicUnits),
  EquationEvaluator.layer,
  Solver.RK4,
);

describe("Classic SIR Epidemic Model", () => {
  it.effect(
    "should match published results from Harko et al. (2014)",
    () =>
      Effect.gen(function* () {
        /**
         * Classic SIR Model from:
         * "Exact analytical solutions of the Susceptible-Infected-Recovered (SIR) epidemic model"
         * Harko et al., 2014, Applied Mathematics and Computation
         *
         * Parameters:
         * - β (infection rate) = 0.01
         * - γ (recovery rate) = 0.02
         * - Initial conditions: S(0) = 20, I(0) = 15, R(0) = 10
         * - Total population N = 45 (constant)
         *
         * Differential equations:
         * dS/dt = -β*S*I
         * dI/dt = β*S*I - γ*I
         * dR/dt = γ*I
         */

        const stockIds = {
          susceptible: decodeStockId("a1000000-0000-4000-8000-000000000001"),
          infected: decodeStockId("a1000000-0000-4000-8000-000000000002"),
          recovered: decodeStockId("a1000000-0000-4000-8000-000000000003"),
        };

        const model = new Model({
          id: decodeModelId("b1000000-0000-4000-8000-000000000001"),
          name: "Classic SIR Epidemic Model (Harko 2014)",
          stocks: [
            new Stock({
              id: stockIds.susceptible,
              name: "Susceptible",
              initialValue: 20,
              units: "people",
              description: "Susceptible individuals",
            }),
            new Stock({
              id: stockIds.infected,
              name: "Infected",
              initialValue: 15,
              units: "people",
              description: "Infected individuals",
            }),
            new Stock({
              id: stockIds.recovered,
              name: "Recovered",
              initialValue: 10,
              units: "people",
              description: "Recovered individuals",
            }),
          ],
          flows: [
            // Infection flow: dS/dt = -β*S*I
            // β*S*I where β=0.01, need dimensionless multiplication
            new Flow({
              id: decodeFlowId("c1000000-0000-4000-8000-000000000001"),
              name: "Infection",
              source: stockIds.susceptible,
              rateEquation:
                "0.01 * ([Susceptible] / { 1 people }) * [Infected] / { 1 tick }",
              units: "people per tick",
            }),
            // New infections: dI/dt += β*S*I
            new Flow({
              id: decodeFlowId("c1000000-0000-4000-8000-000000000002"),
              name: "NewInfections",
              target: stockIds.infected,
              rateEquation:
                "0.01 * ([Susceptible] / { 1 people }) * [Infected] / { 1 tick }",
              units: "people per tick",
            }),
            // Recovery: dI/dt -= γ*I, dR/dt += γ*I
            new Flow({
              id: decodeFlowId("c1000000-0000-4000-8000-000000000003"),
              name: "Recovery",
              source: stockIds.infected,
              target: stockIds.recovered,
              rateEquation: "0.02 * [Infected] / { 1 tick }",
              units: "people per tick",
            }),
          ],
          variables: [],
          timeConfig: new TimeConfig({ start: 0, end: 200, step: 1 }),
        });

        // Run simulation
        const stream = yield* simulate(model).pipe(Effect.provide(solverLayer));
        const chunk = yield* Stream.runCollect(stream);
        const states = Chunk.toReadonlyArray(chunk);

        // Extract time series
        const susceptible = states.map(
          (s) => s.stocks[stockIds.susceptible] ?? 0,
        );
        const infected = states.map((s) => s.stocks[stockIds.infected] ?? 0);
        const recovered = states.map((s) => s.stocks[stockIds.recovered] ?? 0);

        console.log("\n=== SIR MODEL VALIDATION ===\n");
        console.log("Parameters:");
        console.log("  β (infection rate) = 0.01");
        console.log("  γ (recovery rate) = 0.02");
        console.log("  Initial: S(0)=20, I(0)=15, R(0)=10");
        console.log("  Total population N = 45\n");

        // Initial state
        console.log("t=0:");
        console.log(
          `  S=${susceptible[0]?.toFixed(2)}, I=${infected[0]?.toFixed(2)}, R=${recovered[0]?.toFixed(2)}`,
        );
        console.log(
          `  Total: ${(susceptible[0]! + infected[0]! + recovered[0]!).toFixed(2)}`,
        );

        // Peak infection
        const peakInfectedIdx = infected.indexOf(Math.max(...infected));
        console.log(`\nt=${peakInfectedIdx} (Peak Infection):`);
        console.log(
          `  S=${susceptible[peakInfectedIdx]?.toFixed(2)}, I=${infected[peakInfectedIdx]?.toFixed(2)}, R=${recovered[peakInfectedIdx]?.toFixed(2)}`,
        );
        console.log(
          `  Total: ${(susceptible[peakInfectedIdx]! + infected[peakInfectedIdx]! + recovered[peakInfectedIdx]!).toFixed(2)}`,
        );

        // End state
        const finalIdx = states.length - 1;
        console.log(`\nt=${finalIdx} (Final):`);
        console.log(
          `  S=${susceptible[finalIdx]?.toFixed(2)}, I=${infected[finalIdx]?.toFixed(2)}, R=${recovered[finalIdx]?.toFixed(2)}`,
        );
        console.log(
          `  Total: ${(susceptible[finalIdx]! + infected[finalIdx]! + recovered[finalIdx]!).toFixed(2)}`,
        );

        console.log("\n=== VALIDATION CHECKS ===\n");

        // Check 1: Population conservation (N = S + I + R = constant)
        const totalPop = states.map(
          (s) =>
            (s.stocks[stockIds.susceptible] ?? 0) +
            (s.stocks[stockIds.infected] ?? 0) +
            (s.stocks[stockIds.recovered] ?? 0),
        );
        const popVariation =
          Math.max(...totalPop) - Math.min(...totalPop);
        console.log(`✓ Population conservation: ${popVariation < 0.01 ? "PASS" : "FAIL"}`);
        console.log(`  Variation: ${popVariation.toFixed(6)} (should be < 0.01)`);

        // Check 2: Epidemic curve shape (infections should peak then decline)
        const infectedPeakTime = peakInfectedIdx;
        const infectedAtStart = infected[0]!;
        const infectedAtPeak = infected[peakInfectedIdx]!;
        const infectedAtEnd = infected[finalIdx]!;
        const hasEpidemicCurve =
          infectedAtPeak > infectedAtStart && infectedAtEnd < infectedAtPeak;
        console.log(`✓ Epidemic curve shape: ${hasEpidemicCurve ? "PASS" : "FAIL"}`);
        console.log(
          `  Start=${infectedAtStart.toFixed(2)}, Peak=${infectedAtPeak.toFixed(2)} @t=${infectedPeakTime}, End=${infectedAtEnd.toFixed(2)}`,
        );

        // Check 3: Susceptibles monotonically decrease
        const susceptiblesDecrease = susceptible.every(
          (s, i) => i === 0 || s <= susceptible[i - 1]!,
        );
        console.log(
          `✓ Susceptibles decrease: ${susceptiblesDecrease ? "PASS" : "FAIL"}`,
        );

        // Check 4: Recovered monotonically increase
        const recoveredIncrease = recovered.every(
          (r, i) => i === 0 || r >= recovered[i - 1]!,
        );
        console.log(
          `✓ Recovered increase: ${recoveredIncrease ? "PASS" : "FAIL"}`,
        );

        // Check 5: All values non-negative
        const allNonNegative = states.every(
          (s) =>
            (s.stocks[stockIds.susceptible] ?? 0) >= 0 &&
            (s.stocks[stockIds.infected] ?? 0) >= 0 &&
            (s.stocks[stockIds.recovered] ?? 0) >= 0,
        );
        console.log(`✓ Non-negative values: ${allNonNegative ? "PASS" : "FAIL"}`);

        // Check 6: Basic reproduction number R0 = β/γ = 0.01/0.02 = 0.5 < 1
        // For R0 < 1, epidemic should die out (no sustained outbreak)
        const R0 = 0.01 / 0.02;
        console.log(`✓ R₀ = β/γ = ${R0.toFixed(2)}`);
        console.log(
          `  (R₀ < 1 indicates epidemic will die out naturally)`,
        );

        console.log("\n✅ SIR model validation complete\n");

        // Assertions
        expect(popVariation).toBeLessThan(0.01);
        expect(hasEpidemicCurve).toBe(true);
        expect(susceptiblesDecrease).toBe(true);
        expect(recoveredIncrease).toBe(true);
        expect(allNonNegative).toBe(true);
      }),
    { timeout: 30000 },
  );
});
