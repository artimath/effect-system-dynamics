import { DelayStateStore } from "./DelayState.js";
import { EquationEvaluationError } from "../errors.js";
import {
  Quantity,
  UnitMap,
  addQuantities,
  divideQuantities,
  equalUnits,
  isUnitless,
  makeQuantity,
  multiplyQuantities,
  negateQuantity,
  powQuantities,
  subtractQuantities,
  unitlessQuantity,
} from "../Quantity.js";
import type {
  BinaryNode,
  CallNode,
  DelayNode,
  EquationNode,
  Expr,
  FunctionDefNode,
  IfChainNode,
  Lookup1DNode,
  TimeNode,
} from "./Ast.js";

const EPSILON = 1e-12;

type Scope = Readonly<Record<string, Quantity>>;

interface Macro {
  readonly name: string;
  readonly params: ReadonlyArray<string>;
  readonly body: Expr;
}

interface EvalContext {
  readonly scope: Scope;
  readonly macros: Map<string, Macro>;
  readonly source: string;
  readonly callStack: ReadonlyArray<string>;
  readonly delayState: DelayStateStore;
  readonly commitDelay: boolean;
  readonly timeStep?: Quantity;
}

export interface EvaluationOptions {
  readonly delayState?: DelayStateStore;
  readonly commit?: boolean;
}

const BUILTIN_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: (x) => Math.abs(x),
  acos: (x) => Math.acos(x),
  asin: (x) => Math.asin(x),
  atan: (x) => Math.atan(x),
  ceil: (x) => Math.ceil(x),
  cos: (x) => Math.cos(x),
  exp: (x) => Math.exp(x),
  floor: (x) => Math.floor(x),
  log: (x) => Math.log(x),
  log10: (x) => (Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10),
  max: (...values) => {
    if (values.length === 0) {
      throw new Error("max requires at least one argument");
    }
    return Math.max(...values);
  },
  min: (...values) => {
    if (values.length === 0) {
      throw new Error("min requires at least one argument");
    }
    return Math.min(...values);
  },
  pow: (base, exponent) => Math.pow(base, exponent),
  round: (x) => Math.round(x),
  sin: (x) => Math.sin(x),
  sqrt: (x) => Math.sqrt(x),
  tan: (x) => Math.tan(x),
};

const booleanToQuantity = (value: boolean): Quantity => unitlessQuantity(value ? 1 : 0);

const quantityToBoolean = (quantity: Quantity, ctx: EvalContext): boolean =>
  ensureUnitless(quantity, ctx) !== 0;

const ensureUnitless = (quantity: Quantity, ctx: EvalContext): number => {
  if (!isUnitless(quantity)) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: "Expected dimensionless value",
    });
  }
  return quantity.value;
};

const lookupReference = (name: string, ctx: EvalContext): Quantity => {
  const value = ctx.scope[name];
  if (!value) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: `Identifier "${name}" is not defined in scope`,
    });
  }
  return value;
};

const lookupReferenceWithAliases = (names: ReadonlyArray<string>, ctx: EvalContext): Quantity => {
  for (const name of names) {
    const value = ctx.scope[name];
    if (value) {
      return value;
    }
  }
  throw new EquationEvaluationError({
    expression: ctx.source,
    problem: `Identifier "${names[0]!}" is not defined in scope`,
  });
};

const findAlias = (scope: Scope, aliases: ReadonlyArray<string>): Quantity | undefined => {
  for (const alias of aliases) {
    const value = scope[alias];
    if (value) {
      return value;
    }
  }
  return undefined;
};

const extendScope = (parent: Scope, bindings: Record<string, Quantity>): Scope => {
  const child = Object.create(parent) as Record<string, Quantity>;
  for (const key of Object.keys(bindings)) {
    child[key] = bindings[key]!;
  }
  return child as Scope;
};

const buildMacros = (
  defs: ReadonlyArray<FunctionDefNode>,
  ctx: EvalContext,
): Map<string, Macro> => {
  const macros = new Map<string, Macro>();
  for (const def of defs) {
    const key = def.name.toLowerCase();
    if (macros.has(key)) {
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: `Duplicate macro definition "${def.name}"`,
      });
    }
    macros.set(key, {
      name: def.name,
      params: def.params,
      body: def.body,
    });
  }
  return macros;
};

const evaluateCall = (node: CallNode, ctx: EvalContext): Quantity => {
  const fnName = node.name;
  const lower = fnName.toLowerCase();
  const args = node.args.map((arg) => evaluateExpr(arg, ctx));

  const macro = ctx.macros.get(lower);
  if (macro) {
    if (args.length !== macro.params.length) {
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: `Macro "${macro.name}" expects ${macro.params.length} arguments but received ${args.length}`,
      });
    }
    if (ctx.callStack.includes(lower)) {
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: `Recursive macro invocation detected for "${macro.name}"`,
      });
    }
    const bindings: Record<string, Quantity> = Object.create(null);
    for (let i = 0; i < macro.params.length; i += 1) {
      bindings[macro.params[i]!] = args[i]!;
    }
    const macroCtx: EvalContext = {
      ...ctx,
      scope: extendScope(ctx.scope, bindings),
      callStack: [...ctx.callStack, lower],
    };
    return evaluateExpr(macro.body, macroCtx);
  }

  const fn = BUILTIN_FUNCTIONS[lower];
  if (!fn) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: `Unknown function "${fnName}"`,
    });
  }
  try {
    const numericArgs = args.map((arg) => ensureUnitless(arg, ctx));
    return unitlessQuantity(fn(...numericArgs));
  } catch (error) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: error instanceof Error ? error.message : String(error),
    });
  }
};

const evaluateBinary = (node: BinaryNode, ctx: EvalContext): Quantity => {
  const left = evaluateExpr(node.left, ctx);
  const right = () => evaluateExpr(node.right, ctx);

  switch (node.op) {
    case "+":
      try {
        return addQuantities(left, right(), ctx.source);
      } catch (error) {
        if (error instanceof Error && error.message === "UnitMismatch") {
          throw new EquationEvaluationError({
            expression: ctx.source,
            problem: "Cannot add or subtract quantities with incompatible units",
          });
        }
        throw error;
      }
    case "-":
      try {
        return subtractQuantities(left, right(), ctx.source);
      } catch (error) {
        if (error instanceof Error && error.message === "UnitMismatch") {
          throw new EquationEvaluationError({
            expression: ctx.source,
            problem: "Cannot add or subtract quantities with incompatible units",
          });
        }
        throw error;
      }
    case "*":
      return multiplyQuantities(left, right());
    case "/":
      return divideQuantities(left, right());
    case "%":
      return unitlessQuantity(ensureUnitless(left, ctx) % ensureUnitless(right(), ctx));
    case "^": {
      const exponentQuantity = right();
      const exponent = ensureUnitless(exponentQuantity, ctx);
      return powQuantities(left, exponent, ctx.source);
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const rightQuantity = right();
      if (!equalUnits(left.units, rightQuantity.units)) {
        throw new EquationEvaluationError({
          expression: ctx.source,
          problem: "Incompatible units in relational comparison",
        });
      }
      const comparison =
        node.op === "<"
          ? left.value < rightQuantity.value
          : node.op === "<="
            ? left.value <= rightQuantity.value
            : node.op === ">"
              ? left.value > rightQuantity.value
              : left.value >= rightQuantity.value;
      return booleanToQuantity(comparison);
    }
    case "==":
    case "!=": {
      const rightQuantity = right();
      if (!equalUnits(left.units, rightQuantity.units)) {
        throw new EquationEvaluationError({
          expression: ctx.source,
          problem: "Incompatible units in equality comparison",
        });
      }
      const difference = Math.abs(left.value - rightQuantity.value);
      const comparison = node.op === "==" ? difference <= EPSILON : difference > EPSILON;
      return booleanToQuantity(comparison);
    }
    case "AND": {
      const result = quantityToBoolean(left, ctx) && quantityToBoolean(right(), ctx);
      return booleanToQuantity(result);
    }
    case "OR": {
      const result = quantityToBoolean(left, ctx) || quantityToBoolean(right(), ctx);
      return booleanToQuantity(result);
    }
    case "XOR": {
      const l = quantityToBoolean(left, ctx);
      const r = quantityToBoolean(right(), ctx);
      return booleanToQuantity((l && !r) || (!l && r));
    }
    default:
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: `Unsupported operator ${node.op}`,
      });
  }
};

const evaluateIfChain = (node: IfChainNode, ctx: EvalContext): Quantity => {
  for (const branch of node.branches) {
    const condition = quantityToBoolean(evaluateExpr(branch.cond, ctx), ctx);
    if (condition) {
      return evaluateExpr(branch.then, ctx);
    }
  }
  if (node.elseBranch) {
    return evaluateExpr(node.elseBranch, ctx);
  }
  throw new EquationEvaluationError({
    expression: ctx.source,
    problem: "IF expression did not match any branch",
  });
};

const interpolateLookup = (
  x: number,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): number => {
  if (points.length === 0) {
    return 0;
  }
  if (x <= points[0]!.x) {
    return points[0]!.y;
  }
  if (x >= points[points.length - 1]!.x) {
    return points[points.length - 1]!.y;
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const left = points[i]!;
    const right = points[i + 1]!;
    if (x >= left.x && x <= right.x) {
      const span = right.x - left.x;
      if (span === 0) {
        return right.y;
      }
      const ratio = (x - left.x) / span;
      return left.y + ratio * (right.y - left.y);
    }
  }
  return points[points.length - 1]!.y;
};

const ensureMonotonic = (
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  ctx: EvalContext,
) => {
  for (let i = 1; i < points.length; i += 1) {
    if (points[i]!.x <= points[i - 1]!.x) {
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: "LOOKUP table x values must be strictly increasing",
      });
    }
  }
};

const evaluateLookup = (node: Lookup1DNode, ctx: EvalContext): Quantity => {
  ensureMonotonic(node.points, ctx);
  const argQuantity = evaluateExpr(node.x, ctx);
  if (node.xUnit) {
    const unitMismatch = Object.keys(node.xUnit).some(
      (key) => Math.abs((argQuantity.units[key] ?? 0) - node.xUnit![key]!) > EPSILON,
    );
    if (unitMismatch) {
      throw new EquationEvaluationError({
        expression: ctx.source,
        problem: "LOOKUP argument units do not match declared x units",
      });
    }
  } else if (!isUnitless(argQuantity)) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: "LOOKUP argument must be dimensionless when no x units are declared",
    });
  }

  const xValue = ensureUnitless(argQuantity, ctx);
  const interpolated = interpolateLookup(xValue, node.points);
  const outputUnits: UnitMap = node.yUnit ? { ...node.yUnit } : Object.create(null);
  return makeQuantity(interpolated, outputUnits);
};

const initializeDelayStages = (count: number, initQuantity: Quantity): ReadonlyArray<number> =>
  Array.from({ length: count }, () => initQuantity.value);

const ensureStagesLength = (
  stages: ReadonlyArray<number>,
  count: number,
  fallback: number,
): number[] => {
  if (stages.length === count) {
    return [...stages];
  }
  return Array.from({ length: count }, () => fallback);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const ensureTimeStep = (ctx: EvalContext): Quantity => {
  if (!ctx.timeStep) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: "Delay primitives require TIME STEP to be defined in scope",
    });
  }
  return ctx.timeStep;
};

const ensureUnitsMatch = (expected: UnitMap, actual: UnitMap, ctx: EvalContext, reason: string) => {
  if (!equalUnits(expected, actual)) {
    throw new EquationEvaluationError({
      expression: ctx.source,
      problem: reason,
    });
  }
};

const evaluateDelay = (node: DelayNode, ctx: EvalContext): Quantity => {
  const timeStep = ensureTimeStep(ctx);
  const inputQuantity = evaluateExpr(node.input, ctx);
  const tauQuantity = evaluateExpr(node.tau, ctx);

  ensureUnitsMatch(
    timeStep.units,
    tauQuantity.units,
    ctx,
    "Delay time constant must share TIME STEP units",
  );

  const stageCount = node.kind === "DELAY3" || node.kind === "SMOOTH3" ? 3 : 1;
  const store = ctx.delayState;

  let entry = store.get(node.id);
  if (!entry) {
    const initQuantity = node.init ? evaluateExpr(node.init, ctx) : inputQuantity;
    ensureUnitsMatch(
      initQuantity.units,
      inputQuantity.units,
      ctx,
      "Delay initial value units must match input units",
    );
    const stages = initializeDelayStages(stageCount, initQuantity);
    store.set(node.id, { stages, units: { ...initQuantity.units } });
    entry = store.get(node.id)!;
  }

  ensureUnitsMatch(
    entry.units,
    inputQuantity.units,
    ctx,
    "Delay input units changed between evaluations",
  );

  const tauValue = tauQuantity.value;
  const dtValue = timeStep.value;

  let stages = ensureStagesLength(entry.stages, stageCount, inputQuantity.value);
  let resultValue: number;

  if (!Number.isFinite(dtValue) || dtValue <= 0) {
    resultValue = stages[stageCount - 1] ?? inputQuantity.value;
  } else if (!Number.isFinite(tauValue) || tauValue <= 0) {
    stages = Array(stageCount).fill(inputQuantity.value);
    resultValue = inputQuantity.value;
  } else if (stageCount === 1) {
    const alpha = clamp01(dtValue / tauValue);
    const previous = stages[0] ?? inputQuantity.value;
    const updated = previous + alpha * (inputQuantity.value - previous);
    stages[0] = updated;
    resultValue = updated;
  } else {
    const stageTau = tauValue / 3;
    const alpha = stageTau <= 0 ? 1 : clamp01(dtValue / stageTau);

    let stage1 = stages[0] ?? inputQuantity.value;
    let stage2 = stages[1] ?? stage1;
    let stage3 = stages[2] ?? stage2;

    if (alpha >= 1) {
      stage1 = inputQuantity.value;
      stage2 = stage1;
      stage3 = stage2;
    } else {
      stage1 = stage1 + alpha * (inputQuantity.value - stage1);
      stage2 = stage2 + alpha * (stage1 - stage2);
      stage3 = stage3 + alpha * (stage2 - stage3);
    }

    stages = [stage1, stage2, stage3];
    resultValue = stage3;
  }

  if (ctx.commitDelay) {
    store.set(node.id, { stages, units: { ...inputQuantity.units } });
  }

  return makeQuantity(resultValue, inputQuantity.units);
};

const evaluateTime = (node: TimeNode, ctx: EvalContext): Quantity => {
  switch (node.kind) {
    case "TIME":
      return lookupReferenceWithAliases(["TIME", "time", "Time"], ctx);
    case "TIME_STEP":
      return lookupReferenceWithAliases(["TIME STEP", "TIME_STEP", "timeStep", "dt"], ctx);
    case "INITIAL_TIME":
      return lookupReferenceWithAliases(["INITIAL TIME", "initialTime"], ctx);
    case "FINAL_TIME":
      return lookupReferenceWithAliases(["FINAL TIME", "finalTime"], ctx);
  }
};

const evaluateExpr = (expr: Expr, ctx: EvalContext): Quantity => {
  switch (expr._tag) {
    case "QuantityLiteral":
      return makeQuantity(expr.value, expr.unit ?? Object.create(null));
    case "BooleanLiteral":
      return booleanToQuantity(expr.value);
    case "Ref":
      return lookupReference(expr.name, ctx);
    case "Unary": {
      const value = evaluateExpr(expr.expr, ctx);
      switch (expr.op) {
        case "Neg":
          return negateQuantity(value);
        case "Pos":
          return value;
        case "Not":
          return booleanToQuantity(!quantityToBoolean(value, ctx));
      }
    }
    case "Binary":
      return evaluateBinary(expr, ctx);
    case "Call":
      return evaluateCall(expr, ctx);
    case "IfChain":
      return evaluateIfChain(expr, ctx);
    case "Lookup1D":
      return evaluateLookup(expr, ctx);
    case "Delay":
      return evaluateDelay(expr, ctx);
    case "Time":
      return evaluateTime(expr, ctx);
    default: {
      const exhaustive: never = expr;
      throw exhaustive;
    }
  }
};

export const evaluateEquationAst = (
  equation: EquationNode,
  scope: Scope,
  source: string,
  options?: EvaluationOptions,
): Quantity => {
  const delayState = options?.delayState ?? new DelayStateStore();
  const commitDelay = options?.commit ?? true;
  const timeStep = findAlias(scope, ["TIME STEP", "TIME_STEP", "timeStep", "dt"]);

  const baseContext: EvalContext = {
    scope,
    macros: new Map(),
    source,
    callStack: [],
    delayState,
    commitDelay,
  };
  const contextWithDt = timeStep ? ({ ...baseContext, timeStep } as EvalContext) : baseContext;
  const macros = buildMacros(equation.defs, contextWithDt);
  const ctx: EvalContext = { ...contextWithDt, macros };
  return evaluateExpr(equation.expr, ctx);
};
