import { Data, Effect } from "effect";
import { EquationEvaluationError } from "./errors.js";
import { makeQuantity } from "./Quantity.js";
import { EquationDiagnosticError, evaluateEquationAst, parseEquationAst, } from "./v2/public.js";
export class EquationGraphBuildError extends Data.TaggedError("EquationGraphBuildError") {
}
export class EquationGraphCycleError extends Data.TaggedError("EquationGraphCycleError") {
}
const BRACKET_TOKEN = /\[([^\]]+)\]/g;
const IDENTIFIER = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const extractDependencies = (variable, variableTokenSet) => {
    const dependencies = new Set();
    const equation = variable.equation ?? "";
    for (const match of equation.matchAll(BRACKET_TOKEN)) {
        const token = match[1]?.trim();
        if (token && variableTokenSet.has(token) && token !== variable.name && token !== variable.id) {
            dependencies.add(token);
        }
    }
    for (const match of equation.matchAll(IDENTIFIER)) {
        const token = match[0];
        if (token &&
            variableTokenSet.has(token) &&
            token !== variable.name &&
            token !== variable.id) {
            dependencies.add(token);
        }
    }
    return dependencies;
};
export const compileEquationGraph = (variables) => Effect.gen(function* () {
    const tokenMap = new Map();
    const variablesById = new Map();
    const constants = [];
    const auxVariables = [];
    const astById = new Map();
    const sourceById = new Map();
    for (const variable of variables) {
        tokenMap.set(variable.id, variable);
        tokenMap.set(variable.name, variable);
        variablesById.set(variable.id, variable);
        if (variable.type === "constant" && variable.value !== undefined) {
            constants.push(variable);
        }
        else if (variable.type === "constant" && variable.value === undefined) {
            throw new EquationGraphBuildError({
                reason: `Constant "${variable.name}" is missing a value`,
            });
        }
        else {
            auxVariables.push(variable);
        }
        const expression = variable.equation;
        if (expression && expression.trim().length > 0) {
            try {
                const ast = parseEquationAst(expression);
                astById.set(variable.id, ast);
                sourceById.set(variable.id, expression);
            }
            catch (error) {
                if (error instanceof EquationDiagnosticError) {
                    throw new EquationGraphBuildError({
                        reason: `Equation for "${variable.name}" failed to parse: ${error.diagnostic.message}`,
                    });
                }
                throw error;
            }
        }
    }
    const dependencyMap = new Map();
    const dependents = new Map();
    for (const variable of auxVariables) {
        const dependencies = extractDependencies(variable, new Set(tokenMap.keys()));
        dependencyMap.set(variable.id, dependencies);
        for (const depToken of dependencies) {
            const dependency = tokenMap.get(depToken);
            if (!dependency) {
                continue;
            }
            if (dependency.type === "constant" && dependency.value !== undefined) {
                continue;
            }
            const set = dependents.get(dependency.id) ?? new Set();
            set.add(variable.id);
            dependents.set(dependency.id, set);
        }
    }
    const nodeIds = auxVariables.map((v) => v.id);
    const inDegree = new Map();
    for (const id of nodeIds) {
        inDegree.set(id, 0);
    }
    for (const deps of dependencyMap.values()) {
        for (const token of deps) {
            const dependency = tokenMap.get(token);
            if (!dependency) {
                continue;
            }
            if (dependency.type === "constant" && dependency.value !== undefined) {
                continue;
            }
            const current = inDegree.get(dependency.id);
            if (current === undefined) {
                continue;
            }
            inDegree.set(dependency.id, current);
        }
    }
    for (const [nodeId, deps] of dependencyMap) {
        for (const token of deps) {
            const dependency = tokenMap.get(token);
            if (!dependency) {
                continue;
            }
            if (dependency.type === "constant" && dependency.value !== undefined) {
                continue;
            }
            const current = inDegree.get(nodeId) ?? 0;
            inDegree.set(nodeId, current + 1);
        }
        if (!deps.size) {
            inDegree.set(nodeId, inDegree.get(nodeId) ?? 0);
        }
    }
    const queue = [];
    for (const id of nodeIds) {
        if ((inDegree.get(id) ?? 0) === 0) {
            queue.push(id);
        }
    }
    const order = [];
    while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        const outgoing = dependents.get(id);
        if (!outgoing) {
            continue;
        }
        for (const target of outgoing) {
            const current = inDegree.get(target);
            if (current === undefined) {
                continue;
            }
            const next = current - 1;
            inDegree.set(target, next);
            if (next === 0) {
                queue.push(target);
            }
        }
    }
    if (order.length !== nodeIds.length) {
        const remaining = nodeIds.filter((id) => !order.includes(id));
        throw new EquationGraphCycleError({ nodes: remaining });
    }
    return {
        order,
        variablesById,
        tokenToVariable: tokenMap,
        constants,
        astById,
        sourceById,
    };
});
export const evaluateEquationGraph = (compiled, scope, options) => Effect.gen(function* () {
    const results = Object.assign({}, scope);
    for (const constant of compiled.constants) {
        if (constant.value === undefined) {
            continue;
        }
        const quantity = makeQuantity(constant.value);
        results[constant.name] = quantity;
        results[constant.id] = quantity;
    }
    for (const nodeId of compiled.order) {
        const node = compiled.variablesById.get(nodeId);
        if (!node) {
            continue;
        }
        const source = compiled.sourceById.get(nodeId) ?? node.equation ?? "";
        const cachedAst = compiled.astById.get(nodeId);
        const quantity = yield* Effect.try({
            try: () => {
                if (cachedAst) {
                    return evaluateEquationAst(cachedAst, results, source, options);
                }
                if (source.trim().length === 0) {
                    throw new EquationEvaluationError({
                        expression: node.name,
                        problem: `Equation for "${node.name}" is empty`,
                    });
                }
                const parsed = parseEquationAst(source);
                return evaluateEquationAst(parsed, results, source, options);
            },
            catch: (error) => {
                if (error instanceof EquationEvaluationError) {
                    throw error;
                }
                if (error instanceof EquationDiagnosticError) {
                    throw new EquationEvaluationError({
                        expression: source,
                        problem: error.diagnostic.message,
                    });
                }
                throw new EquationEvaluationError({
                    expression: source,
                    problem: error instanceof Error ? error.message : String(error),
                });
            },
        });
        results[node.name] = quantity;
        results[node.id] = quantity;
    }
    const values = Object.create(null);
    const units = Object.create(null);
    for (const variable of compiled.variablesById.values()) {
        const quantity = results[variable.id];
        if (!quantity) {
            continue;
        }
        values[variable.id] = quantity.value;
        units[variable.id] = { ...quantity.units };
    }
    for (const constant of compiled.constants) {
        const quantity = results[constant.id];
        if (!quantity) {
            continue;
        }
        values[constant.id] = quantity.value;
        units[constant.id] = { ...quantity.units };
    }
    return { values, units, scope: results };
});
//# sourceMappingURL=GraphEngine.js.map