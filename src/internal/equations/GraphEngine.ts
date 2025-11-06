import { Data, Effect } from "effect"
import type { Variable } from "../../Model.js"
import { EquationEvaluationError } from "./errors.js"
import type { EquationEvaluationOptions } from "./EquationEngine.js"
import { Quantity, makeQuantity } from "./Quantity.js"
import {
  EquationDiagnosticError,
  evaluateEquationAst,
  parseEquationAst,
} from "./v2/public.js"
import type { EquationNode } from "./v2/Ast.js"

export class EquationGraphBuildError extends Data.TaggedError("EquationGraphBuildError")<{
  readonly reason: string
}> {}

export class EquationGraphCycleError extends Data.TaggedError("EquationGraphCycleError")<{
  readonly nodes: ReadonlyArray<string>
}> {}

const BRACKET_TOKEN = /\[([^\]]+)\]/g
const IDENTIFIER = /\b[A-Za-z_][A-Za-z0-9_]*\b/g

const extractDependencies = (
  variable: Variable,
  variableTokenSet: ReadonlySet<string>,
): ReadonlySet<string> => {
  const dependencies = new Set<string>()
  const equation = variable.equation ?? ""

  for (const match of equation.matchAll(BRACKET_TOKEN)) {
    const token = match[1]?.trim()
    if (token && variableTokenSet.has(token) && token !== variable.name && token !== variable.id) {
      dependencies.add(token)
    }
  }

  for (const match of equation.matchAll(IDENTIFIER)) {
    const token = match[0]
    if (
      token &&
      variableTokenSet.has(token) &&
      token !== variable.name &&
      token !== variable.id
    ) {
      dependencies.add(token)
    }
  }

  return dependencies
}

export interface CompiledEquationGraph {
  readonly order: ReadonlyArray<string>
  readonly variablesById: ReadonlyMap<string, Variable>
  readonly tokenToVariable: ReadonlyMap<string, Variable>
  readonly constants: ReadonlyArray<Variable>
  readonly astById: ReadonlyMap<string, EquationNode>
  readonly sourceById: ReadonlyMap<string, string>
}

export const compileEquationGraph = (
  variables: ReadonlyArray<Variable>,
): Effect.Effect<CompiledEquationGraph, EquationGraphBuildError | EquationGraphCycleError> =>
  Effect.gen(function* () {
    const tokenMap = new Map<string, Variable>()
    const variablesById = new Map<string, Variable>()
    const constants: Array<Variable> = []
    const auxVariables: Array<Variable> = []
    const astById = new Map<string, EquationNode>()
    const sourceById = new Map<string, string>()

    for (const variable of variables) {
      tokenMap.set(variable.id, variable)
      tokenMap.set(variable.name, variable)
      variablesById.set(variable.id, variable)
      if (variable.type === "constant" && variable.value !== undefined) {
        constants.push(variable)
      } else if (variable.type === "constant" && variable.value === undefined) {
        throw new EquationGraphBuildError({
          reason: `Constant "${variable.name}" is missing a value`,
        })
      } else {
        auxVariables.push(variable)
      }

      const expression = variable.equation
      if (expression && expression.trim().length > 0) {
        try {
          const ast = parseEquationAst(expression)
          astById.set(variable.id, ast)
          sourceById.set(variable.id, expression)
        } catch (error) {
          if (error instanceof EquationDiagnosticError) {
            throw new EquationGraphBuildError({
              reason: `Equation for "${variable.name}" failed to parse: ${error.diagnostic.message}`,
            })
          }
          throw error
        }
      }
    }

    const dependencyMap = new Map<string, ReadonlySet<string>>()
    const dependents = new Map<string, Set<string>>()

    for (const variable of auxVariables) {
      const dependencies = extractDependencies(variable, new Set(tokenMap.keys()))
      dependencyMap.set(variable.id, dependencies)
      for (const depToken of dependencies) {
        const dependency = tokenMap.get(depToken)
        if (!dependency) {
          continue
        }
        if (dependency.type === "constant" && dependency.value !== undefined) {
          continue
        }
        const set = dependents.get(dependency.id) ?? new Set<string>()
        set.add(variable.id)
        dependents.set(dependency.id, set)
      }
    }

    const nodeIds = auxVariables.map((v) => v.id)
    const inDegree = new Map<string, number>()
    for (const id of nodeIds) {
      inDegree.set(id, 0)
    }

    for (const deps of dependencyMap.values()) {
      for (const token of deps) {
        const dependency = tokenMap.get(token)
        if (!dependency) {
          continue
        }
        if (dependency.type === "constant" && dependency.value !== undefined) {
          continue
        }
        const current = inDegree.get(dependency.id)
        if (current === undefined) {
          continue
        }
        inDegree.set(dependency.id, current)
      }
    }

    for (const [nodeId, deps] of dependencyMap) {
      for (const token of deps) {
        const dependency = tokenMap.get(token)
        if (!dependency) {
          continue
        }
        if (dependency.type === "constant" && dependency.value !== undefined) {
          continue
        }
        const current = inDegree.get(nodeId) ?? 0
        inDegree.set(nodeId, current + 1)
      }
      if (!deps.size) {
        inDegree.set(nodeId, inDegree.get(nodeId) ?? 0)
      }
    }

    const queue: Array<string> = []
    for (const id of nodeIds) {
      if ((inDegree.get(id) ?? 0) === 0) {
        queue.push(id)
      }
    }

    const order: Array<string> = []
    while (queue.length > 0) {
      const id = queue.shift()!
      order.push(id)
      const outgoing = dependents.get(id)
      if (!outgoing) {
        continue
      }
      for (const target of outgoing) {
        const current = inDegree.get(target)
        if (current === undefined) {
          continue
        }
        const next = current - 1
        inDegree.set(target, next)
        if (next === 0) {
          queue.push(target)
        }
      }
    }

    if (order.length !== nodeIds.length) {
      const remaining = nodeIds.filter((id) => !order.includes(id))
      throw new EquationGraphCycleError({ nodes: remaining })
    }

    return {
      order,
      variablesById,
      tokenToVariable: tokenMap,
      constants,
      astById,
      sourceById,
    }
  })

export const evaluateEquationGraph = (
  compiled: CompiledEquationGraph,
  scope: Record<string, Quantity>,
  options?: EquationEvaluationOptions,
): Effect.Effect<
  {
    readonly values: Record<string, number>
    readonly units: Record<string, Record<string, number>>
    readonly scope: Record<string, Quantity>
  },
  EquationEvaluationError
> =>
  Effect.gen(function* () {
    const results = Object.assign({}, scope)

    for (const constant of compiled.constants) {
      if (constant.value === undefined) {
        continue
      }
      const quantity = makeQuantity(constant.value)
      results[constant.name] = quantity
      results[constant.id] = quantity
    }

    for (const nodeId of compiled.order) {
      const node = compiled.variablesById.get(nodeId)
      if (!node) {
        continue
      }
      const source = compiled.sourceById.get(nodeId) ?? node.equation ?? ""
      const cachedAst = compiled.astById.get(nodeId)
      const quantity = yield* Effect.try({
        try: () => {
          if (cachedAst) {
            return evaluateEquationAst(cachedAst, results, source, options)
          }
          if (source.trim().length === 0) {
            throw new EquationEvaluationError({
              expression: node.name,
              problem: `Equation for "${node.name}" is empty`,
            })
          }
          const parsed = parseEquationAst(source)
          return evaluateEquationAst(parsed, results, source, options)
        },
        catch: (error) => {
          if (error instanceof EquationEvaluationError) {
            throw error
          }
          if (error instanceof EquationDiagnosticError) {
            throw new EquationEvaluationError({
              expression: source,
              problem: error.diagnostic.message,
            })
          }
          throw new EquationEvaluationError({
            expression: source,
            problem: error instanceof Error ? error.message : String(error),
          })
        },
      })

      results[node.name] = quantity
      results[node.id] = quantity
    }

    const values: Record<string, number> = Object.create(null)
    const units: Record<string, Record<string, number>> = Object.create(null)

    for (const variable of compiled.variablesById.values()) {
      const quantity = results[variable.id]
      if (!quantity) {
        continue
      }
      values[variable.id] = quantity.value
      units[variable.id] = { ...quantity.units }
    }

    for (const constant of compiled.constants) {
      const quantity = results[constant.id]
      if (!quantity) {
        continue
      }
      values[constant.id] = quantity.value
      units[constant.id] = { ...quantity.units }
    }

    return { values, units, scope: results }
  })
