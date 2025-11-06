/**
 * Pure Arithmetic Functions (Layer 1)
 *
 * These functions are pure TypeScript with NO Effect wrapping for maximum JIT optimization.
 * They handle the hot path of numerical integration where performance matters most.
 *
 * Key principle: Effect is for orchestration, not arithmetic. Let V8 optimize this.
 *
 * @since 0.1.0
 * @internal
 */
/**
 * Pure Euler integration step.
 *
 * Performs one timestep of Euler's method: stock_new = stock_old + rate * dt
 * This is the simplest numerical integration method, fast but less accurate than RK4.
 *
 * @param stocks - Current stock values as Record<string, number>
 * @param rates - Current rate of change for each stock
 * @param dt - Timestep size
 * @returns Updated stock values
 *
 * @example
 * ```typescript
 * const stocks = { population: 100 }
 * const rates = { population: 5 }  // growing at 5 per timestep
 * const dt = 0.1
 *
 * const nextStocks = pureEulerStep(stocks, rates, dt)
 * // { population: 100.5 }
 * ```
 *
 * @since 0.1.0
 * @category Pure Functions
 * @internal
 */
export declare function pureEulerStep(stocks: Record<string, number>, rates: Record<string, number>, dt: number): Record<string, number>;
/**
 * Blend four RK4 rate samples into final weighted average.
 *
 * RK4 (Runge-Kutta 4th order) computes four intermediate rates (k1, k2, k3, k4)
 * and blends them: (k1 + 2*k2 + 2*k3 + k4) / 6
 *
 * This gives 4th-order accuracy, much better than Euler's 1st-order.
 *
 * @param k1 - Rates at start of timestep
 * @param k2 - Rates at midpoint using k1
 * @param k3 - Rates at midpoint using k2
 * @param k4 - Rates at end using k3
 * @returns Weighted average rates
 *
 * @example
 * ```typescript
 * const k1 = { population: 1.0 }
 * const k2 = { population: 1.1 }
 * const k3 = { population: 1.05 }
 * const k4 = { population: 1.15 }
 *
 * const blended = blendRK4Rates(k1, k2, k3, k4)
 * // { population: (1.0 + 2*1.1 + 2*1.05 + 1.15) / 6 }
 * // { population: 1.075 }
 * ```
 *
 * @since 0.1.0
 * @category Pure Functions
 * @internal
 */
export declare function blendRK4Rates(k1: Record<string, number>, k2: Record<string, number>, k3: Record<string, number>, k4: Record<string, number>): Record<string, number>;
/**
 * Combine a sequence of rate samples using Runge–Kutta coefficients.
 *
 * Computes `base + dt * Σ (coefficients[i] * rates[i])` for every stock id.
 *
 * @param base - Baseline stock values
 * @param rates - Array of rate samples (`k1`, `k2`, ...)
 * @param coefficients - Matching coefficients for each rate sample
 * @param dt - Timestep scaling factor
 * @returns Updated stock values after applying the weighted rates
 *
 * @since 0.1.0
 * @category Pure Functions
 * @internal
 */
export declare function combineRates(base: Record<string, number>, rates: ReadonlyArray<Record<string, number>>, coefficients: ReadonlyArray<number>, dt: number): Record<string, number>;
//# sourceMappingURL=pure.d.ts.map