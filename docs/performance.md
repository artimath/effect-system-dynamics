# Solver Performance Baseline

_Date: October 31, 2025_

This note captures the current solver performance snapshot after introducing
flow equation caching and the Monte Carlo analytics work in PR‑31.

## Benchmark Setup

- Hardware: local Apple M3 Max (reported by CI agent) running Node.js 22.15.0.
- Command: `VITEST_MODE=bench pnpm --filter @org/effect-system-dynamics test -- test/perf/Solver.bench.test.ts`
- Model: single-stock growth system with two auxiliary variables (matches
  `test/perf/Solver.bench.test.ts`).
- Step configuration: Euler step `Δt = 0.01`, simulated horizon `0 → 10`
  (1 000 solver steps per benchmark invocation).

## Results

| Run | Elapsed (ms) |
| --- | ------------ |
| #1  | 963.42       |
| #2  | 951.87       |
| #3  | 958.11       |

Mean: **957.8 ms**, StdDev: **4.7 ms**

## Observations

- Moving flow evaluation to the cached AST path shaved ~27% off the previous
  baseline (down from ~1.32 s/1 000 steps to ~0.96 s on the same workload).
- The remaining hot spots are dominated by `Quantity` allocations inside
  `computeDynamics` (scope reconstruction + rate validation). Profiling via the
  Node inspector shows >60% of samples inside `makeQuantity` and unit cloning.
- Adaptive solver performance mirrors RK4 (±5%) because both paths share the
  same flow evaluation cost. Future optimisations should focus on reusing
  `Quantity` instances and canonical unit maps between steps.

## Next Steps

1. Prototype a scoped `QuantityPool` so stocks reuse their quantity wrappers
   while only mutating the numeric `value` per step. Estimate: 2–3 × reduction
   in allocations.
2. Extend the benchmark harness with a multi-stock Lotka–Volterra scenario to
   capture graph evaluation pressure (target coverage for PR‑32).
3. Once the pooled quantities land, tighten the regression gate in
   `test/perf/Solver.bench.test.ts` from 1 200 ms to ≤200 ms, marching toward the
   long-term <50 ms target recorded in `docs/ATOMIC-PRS.md`.
