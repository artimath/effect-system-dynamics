import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { Model, Stock, Variable } from "./Model.js";
import { ScenarioId, ModelId } from "./Types.js";
import { simulateEager, simulateFinal, simulateParallel, } from "./Simulation.js";
/**
 * Scenario definition describing a set of parameter overrides applied to a base model.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioDefinition extends Schema.Class("ScenarioDefinition")({
    id: ScenarioId,
    name: Schema.NonEmptyTrimmedString,
    baseModelId: ModelId,
    overrides: Schema.Record({
        key: Schema.String,
        value: Schema.Number,
    }),
    description: Schema.optional(Schema.String),
}) {
}
/**
 * Summary information for a scenario run.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioSummary extends Schema.Class("ScenarioSummary")({
    scenarioId: ScenarioId,
    name: Schema.NonEmptyTrimmedString,
    finalTime: Schema.Number,
    finalStocks: Schema.Record({ key: Schema.String, value: Schema.Number }),
    finalVariables: Schema.Record({ key: Schema.String, value: Schema.Number }),
    deltaStocks: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Number })),
    deltaVariables: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Number })),
}) {
}
/**
 * Comparison payload between a baseline run and scenario variants.
 *
 * @category Scenarios
 * @since 0.1.0
 */
export class ScenarioComparison extends Schema.Class("ScenarioComparison")({
    baseline: ScenarioSummary,
    scenarios: Schema.Array(ScenarioSummary),
}) {
}
/**
 * Percentile entry generated from Monte Carlo sampling.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloPercentile extends Schema.Class("MonteCarloPercentile")({
    percentile: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(1)),
    value: Schema.Number,
}) {
}
/**
 * Aggregated statistics for a single metric across Monte Carlo samples.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloMetricSummary extends Schema.Class("MonteCarloMetricSummary")({
    name: Schema.NonEmptyTrimmedString,
    mean: Schema.Number,
    variance: Schema.Number,
    min: Schema.Number,
    max: Schema.Number,
    percentiles: Schema.Array(MonteCarloPercentile),
}) {
}
/**
 * Result payload returned by Monte Carlo runs.
 *
 * @category MonteCarlo
 * @since 0.1.0
 */
export class MonteCarloResult extends Schema.Class("MonteCarloResult")({
    iterations: Schema.Number.pipe(Schema.greaterThan(0)),
    metrics: Schema.Array(MonteCarloMetricSummary),
}) {
}
const findOverrideTarget = (model, name) => {
    for (const stock of model.stocks) {
        if (stock.name === name) {
            return Option.some({ kind: "stock", stock });
        }
    }
    for (const variable of model.variables) {
        if (variable.name === name && variable.type === "constant") {
            return Option.some({ kind: "constant", variable });
        }
    }
    return Option.none();
};
/**
 * Raised when scenario overrides reference unknown parameters.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioOverrideNotFoundError extends Data.TaggedError("ScenarioOverrideNotFoundError") {
    get message() {
        const prefix = this.scenarioId ? `Scenario ${this.scenarioId} ` : "Scenario";
        return `${prefix}references unknown overrides: ${this.targets.join(", ")}`;
    }
}
/**
 * Raised when an override targets an unsupported parameter (e.g., auxiliary variable).
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioUnsupportedOverrideError extends Data.TaggedError("ScenarioUnsupportedOverrideError") {
    get message() {
        const prefix = this.scenarioId ? `Scenario ${this.scenarioId}` : "Scenario";
        return `${prefix} cannot override "${this.target}": ${this.reason}`;
    }
}
/**
 * Raised when a requested metric is not present in the simulation output.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioMetricNotFoundError extends Data.TaggedError("ScenarioMetricNotFoundError") {
    get message() {
        return `Metric "${this.name}" was not found in stocks or variables`;
    }
}
/**
 * Raised when Monte Carlo configuration is invalid.
 */
export class MonteCarloConfigurationError extends Data.TaggedError("MonteCarloConfigurationError") {
    get message() {
        return `Invalid Monte Carlo configuration: ${this.reason}`;
    }
}
/**
 * Raised when a scenario references a different base model than the one provided.
 *
 * @category Errors
 * @since 0.1.0
 */
export class ScenarioModelMismatchError extends Data.TaggedError("ScenarioModelMismatchError") {
    get message() {
        return `Scenario ${this.scenarioId} expects model ${this.expected} but received ${this.actual}`;
    }
}
const applyOverrides = (definition, model) => Effect.sync(() => {
    if (definition.baseModelId !== model.id) {
        throw new ScenarioModelMismatchError({
            scenarioId: definition.id,
            expected: definition.baseModelId,
            actual: model.id,
        });
    }
    const overrides = definition.overrides;
    if (Object.keys(overrides).length === 0) {
        return model;
    }
    const unmatched = new Set(Object.keys(overrides));
    const stocks = model.stocks.map((stock) => {
        const override = overrides[stock.name];
        if (override === undefined) {
            return stock;
        }
        unmatched.delete(stock.name);
        return new Stock({
            id: stock.id,
            name: stock.name,
            initialValue: override,
            units: stock.units,
            description: stock.description,
        });
    });
    const variables = model.variables.map((variable) => {
        const override = overrides[variable.name];
        if (override === undefined) {
            return variable;
        }
        unmatched.delete(variable.name);
        if (variable.type !== "constant") {
            throw new ScenarioUnsupportedOverrideError({
                scenarioId: definition.id,
                target: variable.name,
                reason: "only constant variables can be overridden",
            });
        }
        return new Variable({
            id: variable.id,
            name: variable.name,
            equation: variable.equation,
            type: "constant",
            value: override,
        });
    });
    if (unmatched.size > 0) {
        throw new ScenarioOverrideNotFoundError({
            scenarioId: definition.id,
            targets: Array.from(unmatched),
        });
    }
    return new Model({
        id: model.id,
        name: model.name,
        stocks,
        flows: model.flows,
        variables,
        timeConfig: model.timeConfig,
    });
});
const summariseFinalState = (definition, model, final, baseline) => {
    const finalStocks = Object.create(null);
    for (const stock of model.stocks) {
        finalStocks[stock.name] = final.stocks[stock.id] ?? 0;
    }
    const finalVariables = Object.create(null);
    for (const variable of model.variables) {
        finalVariables[variable.name] = final.variables[variable.id] ?? variable.value ?? 0;
    }
    let deltaStocks;
    let deltaVariables;
    if (baseline) {
        const baselineStocksByName = Object.create(null);
        for (const stock of baseline.model.stocks) {
            baselineStocksByName[stock.name] = baseline.state.stocks[stock.id] ?? 0;
        }
        const baselineVariablesByName = Object.create(null);
        for (const variable of baseline.model.variables) {
            baselineVariablesByName[variable.name] =
                baseline.state.variables[variable.id] ?? variable.value ?? 0;
        }
        const stockDeltaMap = Object.create(null);
        for (const name of Object.keys(finalStocks)) {
            const baselineValue = baselineStocksByName[name] ?? 0;
            const finalValue = finalStocks[name] ?? 0;
            stockDeltaMap[name] = finalValue - baselineValue;
        }
        const variableDeltaMap = Object.create(null);
        for (const name of Object.keys(finalVariables)) {
            const baselineValue = baselineVariablesByName[name] ?? 0;
            const finalValue = finalVariables[name] ?? 0;
            variableDeltaMap[name] = finalValue - baselineValue;
        }
        deltaStocks = stockDeltaMap;
        deltaVariables = variableDeltaMap;
    }
    return new ScenarioSummary({
        scenarioId: definition.id,
        name: definition.name,
        finalTime: final.time,
        finalStocks,
        finalVariables,
        deltaStocks,
        deltaVariables,
    });
};
const getMetric = (model, state, name) => {
    const directStock = state.stocks[name];
    if (directStock !== undefined) {
        return Effect.succeed(directStock);
    }
    const stock = model.stocks.find((candidate) => candidate.name === name);
    if (stock) {
        const value = state.stocks[stock.id];
        if (value !== undefined) {
            return Effect.succeed(value);
        }
    }
    const directVariable = state.variables[name];
    if (directVariable !== undefined) {
        return Effect.succeed(directVariable);
    }
    const variable = model.variables.find((candidate) => candidate.name === name);
    if (variable) {
        const value = state.variables[variable.id];
        if (value !== undefined) {
            return Effect.succeed(value);
        }
    }
    return Effect.fail(new ScenarioMetricNotFoundError({ name }));
};
const locateBaselineValue = (model, parameter) => Effect.sync(() => {
    const target = findOverrideTarget(model, parameter);
    if (Option.isNone(target)) {
        throw new ScenarioOverrideNotFoundError({
            targets: [parameter],
        });
    }
    if (target.value.kind === "stock") {
        return target.value.stock.initialValue;
    }
    const variable = target.value.variable;
    if (variable.value === undefined) {
        throw new ScenarioUnsupportedOverrideError({
            target: parameter,
            reason: "constant variable is missing a value",
        });
    }
    return variable.value;
});
const findStateAtTime = (states, time) => {
    for (const state of states) {
        if (state.time >= time) {
            return state;
        }
    }
    const fallback = states.at(-1) ?? states[0];
    if (!fallback) {
        throw new ScenarioMetricNotFoundError({ name: `state@${time}` });
    }
    return fallback;
};
const evaluateOverrides = (scenarioService, model, objective, overrides, scenarioOptions) => Effect.gen(function* () {
    const definition = new ScenarioDefinition({
        id: anonymousScenarioId,
        name: "Optimization",
        baseModelId: model.id,
        overrides,
    });
    const run = yield* scenarioService.run(model, definition, {
        collectStates: true,
        ...scenarioOptions,
    });
    const states = run.states ?? (yield* simulateEager(run.model));
    const stateAtTime = findStateAtTime(states, objective.atTime);
    return yield* getMetric(run.model, stateAtTime, objective.target);
});
const gridStrategy = {
    name: "grid",
    optimize: (context) => Effect.gen(function* () {
        const { model, objective, constraints, scenarioService, options } = context;
        if (constraints.length === 0) {
            const value = yield* evaluateOverrides(scenarioService, model, objective, {}, options.scenarioOptions);
            return { bestParameters: {}, bestValue: value, iterations: 1 };
        }
        const steps = Math.max(2, options.stepsPerParameter ?? 5);
        const valuesByParameter = constraints.map((constraint) => {
            const span = constraint.max - constraint.min;
            const values = [];
            if (steps === 1 || Math.abs(span) < Number.EPSILON) {
                values.push(constraint.min);
            }
            else {
                const stepSize = span / (steps - 1);
                for (let i = 0; i < steps; i++) {
                    values.push(constraint.min + stepSize * i);
                }
            }
            return { parameter: constraint.parameter, values };
        });
        const combinations = [];
        const build = (index, current) => {
            if (index >= valuesByParameter.length) {
                combinations.push({ ...current });
                return;
            }
            const entry = valuesByParameter[index];
            if (!entry) {
                return;
            }
            for (const value of entry.values) {
                current[entry.parameter] = value;
                build(index + 1, current);
            }
        };
        build(0, {});
        let bestValue = Number.NEGATIVE_INFINITY;
        let bestParameters = {};
        let iterations = 0;
        for (const overrides of combinations) {
            iterations += 1;
            const value = yield* evaluateOverrides(scenarioService, model, objective, overrides, options.scenarioOptions);
            const isBetter = objective.direction === "maximize" ? value > bestValue : value < bestValue;
            if (isBetter || bestValue === Number.NEGATIVE_INFINITY) {
                bestValue = value;
                bestParameters = { ...overrides };
            }
        }
        if (combinations.length === 0) {
            const value = yield* evaluateOverrides(scenarioService, model, objective, {}, options.scenarioOptions);
            return { bestParameters: {}, bestValue: value, iterations: iterations + 1 };
        }
        return { bestParameters, bestValue, iterations };
    }),
};
const makeRandomStrategy = (defaultIterations) => ({
    name: "random",
    optimize: (context) => Effect.gen(function* () {
        const { model, objective, constraints, scenarioService, options } = context;
        const iterations = Math.max(1, options.iterations ?? defaultIterations);
        const evaluate = (overrides) => evaluateOverrides(scenarioService, model, objective, overrides, options.scenarioOptions);
        let bestParameters = {};
        let bestValue = yield* evaluateOverrides(scenarioService, model, objective, {}, options.scenarioOptions);
        let evaluated = 1;
        if (constraints.length === 0) {
            return { bestParameters, bestValue, iterations: evaluated };
        }
        for (let i = 0; i < iterations; i++) {
            const overrides = {};
            for (const constraint of constraints) {
                const min = constraint.min;
                const max = constraint.max;
                const value = Math.abs(max - min) < Number.EPSILON
                    ? min
                    : min + Math.random() * (max - min);
                overrides[constraint.parameter] = value;
            }
            const value = yield* evaluate(overrides);
            evaluated += 1;
            const isBetter = objective.direction === "maximize" ? value > bestValue : value < bestValue;
            if (isBetter) {
                bestValue = value;
                bestParameters = { ...overrides };
            }
        }
        return { bestParameters, bestValue, iterations: evaluated };
    }),
});
const resolveStrategy = (options) => {
    const strategyOption = options.strategy;
    if (!strategyOption) {
        return gridStrategy;
    }
    if (typeof strategyOption === "string") {
        if (strategyOption === "grid") {
            return gridStrategy;
        }
        if (strategyOption === "random") {
            return makeRandomStrategy(Math.max(1, options.iterations ?? 50));
        }
    }
    return strategyOption;
};
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const decodeScenarioId = Schema.decodeSync(ScenarioId);
const anonymousScenarioId = decodeScenarioId(ZERO_UUID);
const DEFAULT_MONTE_CARLO_PERCENTILES = Object.freeze([0.5, 0.9, 0.95]);
/**
 * Creates a deterministic pseudo-random number generator using a 32-bit mulberry sequence.
 */
const createDeterministicRng = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    };
};
/**
 * Computes an interpolated percentile using the given sorted samples.
 */
const percentileOf = (sorted, percentile) => {
    if (sorted.length === 0) {
        return 0;
    }
    const clamped = Math.min(1, Math.max(0, percentile));
    const index = (sorted.length - 1) * clamped;
    const lower = Math.floor(index);
    const upper = Math.min(sorted.length - 1, Math.ceil(index));
    if (lower === upper) {
        return sorted[lower];
    }
    const lowerValue = sorted[lower];
    const upperValue = sorted[upper];
    const weight = index - lower;
    return lowerValue + (upperValue - lowerValue) * weight;
};
/**
 * Builds a Monte Carlo metric summary from collected samples.
 */
const summariseMetric = (name, values, percentiles) => {
    const count = values.length;
    if (count === 0) {
        return new MonteCarloMetricSummary({
            name,
            mean: 0,
            variance: 0,
            min: 0,
            max: 0,
            percentiles: [],
        });
    }
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        sum += value;
        if (value < min)
            min = value;
        if (value > max)
            max = value;
    }
    const mean = sum / count;
    let varianceAccumulator = 0;
    for (const value of values) {
        const diff = value - mean;
        varianceAccumulator += diff * diff;
    }
    const variance = count > 1 ? varianceAccumulator / (count - 1) : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const entries = percentiles.map((percentile) => new MonteCarloPercentile({ percentile, value: percentileOf(sorted, percentile) }));
    return new MonteCarloMetricSummary({
        name,
        mean,
        variance,
        min,
        max,
        percentiles: entries,
    });
};
/**
 * Runtime implementation of the ScenarioService interface.
 */
const makeScenarioService = () => {
    const service = {
        branch: (model, definition) => applyOverrides(definition, model).pipe(Effect.map((overriddenModel) => ({
            definition,
            model: overriddenModel,
        }))),
        run: (model, definition, options = {}) => Effect.gen(function* () {
            const result = yield* applyOverrides(definition, model);
            if (options.collectStates) {
                const states = yield* simulateEager(result);
                const final = states.at(-1) ?? (yield* simulateFinal(result));
                return { definition, model: result, final, states };
            }
            const final = yield* simulateFinal(result);
            return { definition, model: result, final };
        }),
        compare: (model, definitions, options = {}) => Effect.gen(function* () {
            const baselineDefinition = new ScenarioDefinition({
                id: anonymousScenarioId,
                name: "Baseline",
                baseModelId: model.id,
                overrides: {},
            });
            const definitionsWithBaseline = [
                baselineDefinition,
                ...definitions,
            ];
            const prepared = yield* Effect.forEach(definitionsWithBaseline, (definition) => applyOverrides(definition, model).pipe(Effect.map((overridden) => ({ definition, model: overridden }))));
            const targets = prepared.map(({ definition, model }) => ({
                id: definition.id,
                model,
                ...(options.collectStates !== undefined ? { collectStates: options.collectStates } : {}),
            }));
            const parallelOptions = {
                ...(options.collectStates !== undefined ? { collectStates: options.collectStates } : {}),
                ...(options.parallelism !== undefined ? { parallelism: options.parallelism } : {}),
            };
            const results = yield* simulateParallel(targets, parallelOptions);
            const baselineResult = results[0];
            const baselineModel = prepared[0].model;
            const baselineRun = {
                definition: baselineDefinition,
                model: baselineModel,
                final: baselineResult.final,
                ...(baselineResult.states ? { states: baselineResult.states } : {}),
            };
            const scenarioRuns = [];
            for (let index = 1; index < results.length; index += 1) {
                const result = results[index];
                const entry = prepared[index];
                if (!result || !entry) {
                    continue;
                }
                scenarioRuns.push({
                    definition: entry.definition,
                    model: entry.model,
                    final: result.final,
                    ...(result.states ? { states: result.states } : {}),
                });
            }
            const baselineSummary = summariseFinalState(baselineDefinition, baselineRun.model, baselineRun.final);
            const scenarios = scenarioRuns.map((run) => summariseFinalState(run.definition, run.model, run.final, {
                state: baselineRun.final,
                model: baselineRun.model,
            }));
            return new ScenarioComparison({ baseline: baselineSummary, scenarios });
        }),
        monteCarlo: (model, baseDefinition, config) => Effect.gen(function* () {
            if (baseDefinition.baseModelId !== model.id) {
                throw new ScenarioModelMismatchError({
                    scenarioId: baseDefinition.id,
                    expected: baseDefinition.baseModelId,
                    actual: model.id,
                });
            }
            const iterations = Math.floor(config.iterations);
            if (!Number.isFinite(iterations) || iterations <= 0) {
                throw new MonteCarloConfigurationError({ reason: "iterations must be a positive integer" });
            }
            if (config.metrics.length === 0) {
                throw new MonteCarloConfigurationError({ reason: "at least one metric must be requested" });
            }
            const parameters = config.parameters;
            const scenarioOptions = {
                ...(config.collectStates !== undefined ? { collectStates: config.collectStates } : {}),
                ...(config.parallelism !== undefined ? { parallelism: config.parallelism } : {}),
            };
            const percentiles = (config.percentiles && config.percentiles.length > 0
                ? config.percentiles
                : DEFAULT_MONTE_CARLO_PERCENTILES)
                .map((value) => Math.min(1, Math.max(0, value)))
                .sort((a, b) => a - b);
            const baselineValues = new Map();
            for (const parameter of parameters) {
                const baseline = yield* locateBaselineValue(model, parameter.name);
                baselineValues.set(parameter.name, baseline);
            }
            const rng = createDeterministicRng(config.seed ?? 0x9e3779b9);
            const metricSamples = new Map();
            for (const metric of config.metrics) {
                metricSamples.set(metric, []);
            }
            const iterationIndices = Array.from({ length: iterations }, (_, index) => index);
            yield* Effect.forEach(iterationIndices, (iteration) => Effect.gen(function* () {
                const overrides = { ...baseDefinition.overrides };
                for (const parameter of parameters) {
                    const baseline = baselineValues.get(parameter.name);
                    if (baseline === undefined) {
                        continue;
                    }
                    const value = parameter.sampler({
                        iteration: iteration + 1,
                        baseline,
                        random: rng,
                    });
                    overrides[parameter.name] = value;
                }
                const definition = new ScenarioDefinition({
                    id: anonymousScenarioId,
                    name: `${baseDefinition.name}#${iteration + 1}`,
                    baseModelId: baseDefinition.baseModelId,
                    overrides,
                });
                const run = yield* service.run(model, definition, scenarioOptions);
                for (const metric of config.metrics) {
                    const value = yield* getMetric(run.model, run.final, metric);
                    metricSamples.get(metric)?.push(value);
                }
            }), { concurrency: config.concurrency ?? "unbounded" });
            const summaries = Array.from(metricSamples.entries()).map(([name, values]) => summariseMetric(name, values, percentiles));
            return new MonteCarloResult({
                iterations,
                metrics: summaries,
            });
        }),
    };
    return service;
};
/**
 * Scenario service tag for dependency injection.
 *
 * @category Services
 * @since 0.1.0
 */
export class ScenarioService extends Context.Tag("@org/effect-system-dynamics/ScenarioService")() {
    /**
     * Default layer providing the in-memory scenario service implementation.
     */
    static layer = Layer.succeed(this, makeScenarioService());
}
/**
 * Sensitivity analysis result capturing the impact of a parameter tweak.
 *
 * @category Sensitivity
 * @since 0.1.0
 */
export class SensitivityResult extends Schema.Class("SensitivityResult")({
    parameter: Schema.String,
    impact: Schema.Number,
    direction: Schema.Literal("positive", "negative", "neutral"),
    confidence: Schema.Number,
}) {
}
const makeSensitivityService = (scenarioService) => ({
    analyze: (model, target, parameters, variationPercent, options = {}) => Effect.gen(function* () {
        const baselineDefinition = new ScenarioDefinition({
            id: anonymousScenarioId,
            name: "Baseline",
            baseModelId: model.id,
            overrides: {},
        });
        const baselineRun = yield* scenarioService.run(model, baselineDefinition, options);
        const baselineMetric = yield* getMetric(model, baselineRun.final, target);
        const results = yield* Effect.forEach(parameters, (parameter) => Effect.gen(function* () {
            const baseValue = yield* locateBaselineValue(model, parameter);
            const overrideValue = baseValue * (1 + variationPercent / 100);
            const definition = new ScenarioDefinition({
                id: anonymousScenarioId,
                name: `Variation: ${parameter}`,
                baseModelId: model.id,
                overrides: { [parameter]: overrideValue },
            });
            const run = yield* scenarioService.run(model, definition, options);
            const metric = yield* getMetric(run.model, run.final, target);
            const difference = metric - baselineMetric;
            const impact = baselineMetric === 0 ? difference : (difference / baselineMetric) * 100;
            const direction = impact === 0
                ? "neutral"
                : impact > 0
                    ? "positive"
                    : "negative";
            return new SensitivityResult({
                parameter,
                impact,
                direction,
                confidence: 1,
            });
        }), { concurrency: "unbounded" });
        return results.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    }),
});
/**
 * Sensitivity service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export class SensitivityService extends Context.Tag("@org/effect-system-dynamics/SensitivityService")() {
    static layer = Layer.effect(this, Effect.gen(function* () {
        const scenarioService = yield* ScenarioService;
        return makeSensitivityService(scenarioService);
    }));
}
/**
 * Optimization objective definition.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class Objective extends Schema.Class("Objective")({
    target: Schema.String,
    direction: Schema.Literal("maximize", "minimize"),
    atTime: Schema.Number,
}) {
}
/**
 * Parameter constraint used during optimization.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class Constraint extends Schema.Class("Constraint")({
    parameter: Schema.String,
    min: Schema.Number,
    max: Schema.Number,
}) {
}
/**
 * Result of the optimization pass.
 *
 * @category Optimization
 * @since 0.1.0
 */
export class OptimizationResult extends Schema.Class("OptimizationResult")({
    objective: Objective,
    bestParameters: Schema.Record({ key: Schema.String, value: Schema.Number }),
    value: Schema.Number,
    iterations: Schema.Number,
    strategy: Schema.String,
}) {
}
const makeOptimizerService = (scenarioService) => ({
    optimize: (model, objective, constraints, options = {}) => Effect.gen(function* () {
        const strategy = resolveStrategy(options);
        const result = yield* strategy.optimize({
            model,
            objective,
            constraints,
            scenarioService,
            options,
        });
        return new OptimizationResult({
            objective,
            bestParameters: result.bestParameters,
            value: result.bestValue,
            iterations: result.iterations,
            strategy: strategy.name,
        });
    }),
});
/**
 * Optimizer service tag.
 *
 * @category Services
 * @since 0.1.0
 */
export class OptimizerService extends Context.Tag("@org/effect-system-dynamics/OptimizerService")() {
    static layer = Layer.effect(this, Effect.gen(function* () {
        const scenarioService = yield* ScenarioService;
        return makeOptimizerService(scenarioService);
    }));
}
/**
 * Aggregated layer wiring Scenario, Sensitivity, and Optimizer services.
 *
 * Provide this layer in combination with `Solver`, `EquationEvaluator`, and `UnitManager`
 * so all scenario pipelines share a consistent service bundle.
 *
 * @category Layers
 * @since 0.1.0
 */
export const ScenarioServicesLayer = Layer.provideMerge(Layer.provideMerge(ScenarioService.layer)(SensitivityService.layer))(OptimizerService.layer);
//# sourceMappingURL=Scenarios.js.map