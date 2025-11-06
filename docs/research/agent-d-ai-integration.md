# AI Integration for System Dynamics

**research status**: design complete
**audience**: developers implementing llm-powered model generation, analysis, and optimization
**dependencies**: `@effect/ai`, `@effect/ai-openai`, core system dynamics library

---

## executive summary

integrating llms into system dynamics makes the library **10x more powerful** by:

1. **democratizing modeling** - users describe systems in natural language, llm generates stock-flow structure
2. **accelerating exploration** - ai runs hundreds of "what-if" scenarios in seconds vs manual parameter tweaking
3. **explaining dynamics** - llm translates simulation math into natural language insights humans actually understand
4. **optimizing outcomes** - ai searches parameter spaces to hit target equilibria users care about

recent research shows llms can generate causal loop diagrams at 56-83% accuracy vs human experts (2024-2025 papers). we can leverage this for full stock-flow model generation.

---

## architecture overview

### workflow: natural language → model → simulation → ai analysis

```
user prompt
  → llm generates stock-flow structure (Tool.make pattern)
  → validate + persist to spanner graph
  → run simulation (euler/rk4 solver as Effect service)
  → llm analyzes results (sensitivity, equilibrium, insights)
  → return structured output + natural language explanation
```

### key abstractions

- **Tool**: effect.ai's schema-based function calling primitive
- **Toolkit**: collection of tools given to llm (simulation operations)
- **LanguageModel**: provider-agnostic llm interface (openai, anthropic, etc)
- **SystemDynamicsTools**: custom toolkit exposing simulation as llm-callable ops

---

## tool specifications

### 1. model generation tool

**purpose**: generate stock-flow model from natural language description

#### schema definition

```typescript
import { Tool } from "@effect/ai"
import { Schema } from "effect"

// input: user's system description
const GenerateModelParams = Schema.Struct({
  description: Schema.String.pipe(
    Schema.annotations({
      description: "Natural language description of the system to model"
    })
  ),
  domains: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.annotations({
      description: "Domain tags for categorization (e.g., 'population', 'finance', 'ecology')"
    })
  ),
  timeHorizon: Schema.optional(Schema.Number).pipe(
    Schema.annotations({
      description: "Simulation time horizon in base time units (default: 100)"
    })
  )
})

// output: structured model definition
const ModelStructure = Schema.Struct({
  stocks: Schema.Array(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    initialValue: Schema.Number,
    unit: Schema.optional(Schema.String)
  })),
  flows: Schema.Array(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    from: Schema.optional(Schema.String), // stock id or null (source)
    to: Schema.optional(Schema.String),   // stock id or null (sink)
    equation: Schema.String,              // mathematical expression
    unit: Schema.optional(Schema.String)
  })),
  variables: Schema.Array(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    equation: Schema.String,
    unit: Schema.optional(Schema.String)
  })),
  causalExplanation: Schema.String.pipe(
    Schema.annotations({
      description: "Natural language explanation of causal relationships"
    })
  )
})

export const GenerateModel = Tool.make("GenerateModel", {
  description: "Generate a system dynamics stock-flow model from natural language description",
  parameters: GenerateModelParams,
  success: ModelStructure,
  failure: Schema.Never
})
```

#### llm prompt template

```typescript
/**
 * constructs prompt for model generation
 * uses few-shot examples from research (2024 papers on cld generation)
 */
export const buildModelGenerationPrompt = (description: string, options?: {
  domains?: string[]
  timeHorizon?: number
}) => ({
  system: `You are an expert system dynamics modeler. Generate stock-flow models from descriptions.

RULES:
1. Stocks represent accumulations (population, inventory, capital, knowledge)
2. Flows are rates of change (births, sales, investment, learning)
3. Variables are intermediate calculations or constants
4. All flows must have valid equations using stocks/variables/constants
5. Use standard math operators: +, -, *, /, ^, sqrt(), exp(), log()
6. Reference stocks/variables by their id in equations
7. Ensure conservation laws (what flows out of one stock flows into another or leaves system)

EQUATION SYNTAX:
- Stock references: stocks.population
- Variable references: vars.growth_rate
- Constants: numeric literals (e.g., 0.05)
- Time: t (current simulation time)

OUTPUT FORMAT: Return valid JSON matching ModelStructure schema.`,

  user: `Generate a system dynamics model for:

${description}

${options?.domains ? `Domains: ${options.domains.join(', ')}` : ''}
${options?.timeHorizon ? `Time horizon: ${options.timeHorizon} time units` : ''}

Provide:
1. Stocks with realistic initial values
2. Flows with equations that capture the dynamics
3. Variables for intermediate calculations
4. Causal explanation of feedback loops and relationships`
})
```

#### handler implementation

```typescript
import { Effect } from "effect"
import { LanguageModel } from "@effect/ai"
import { SpannerGraphClient } from "@org/effect-spanner-graph"

const handleGenerateModel = (params: typeof GenerateModelParams.Type) =>
  Effect.gen(function* () {
    const llm = yield* LanguageModel.LanguageModel
    const client = yield* SpannerGraphClient

    // llm generates model structure
    const prompt = buildModelGenerationPrompt(params.description, {
      domains: params.domains,
      timeHorizon: params.timeHorizon
    })

    const response = yield* llm.generateObject({
      prompt: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      schema: ModelStructure
    })

    const model = response.value

    // validate equations parse correctly
    yield* validateModelEquations(model)

    // persist to spanner graph
    const modelId = yield* persistModelToGraph(client, model, {
      userId: params.userId,
      domains: params.domains ?? []
    })

    return {
      modelId,
      ...model
    }
  })
```

---

### 2. simulation tool

**purpose**: run simulation with given parameters, return time series data

#### schema definition

```typescript
const SimulateParams = Schema.Struct({
  modelId: Schema.String.pipe(
    Schema.annotations({
      description: "ID of the model to simulate (from spanner graph)"
    })
  ),
  timeEnd: Schema.Number.pipe(
    Schema.annotations({
      description: "Simulation end time"
    })
  ),
  timeStep: Schema.optional(Schema.Number).pipe(
    Schema.annotations({
      description: "Integration timestep (default: auto-calculated as timeEnd/100)"
    })
  ),
  solver: Schema.optional(Schema.Literal("euler", "rk4", "adaptive")).pipe(
    Schema.annotations({
      description: "Numerical integration method (default: euler)"
    })
  ),
  parameterOverrides: Schema.optional(Schema.Record(Schema.String, Schema.Number)).pipe(
    Schema.annotations({
      description: "Override initial stock values or variable constants"
    })
  )
})

const SimulationResult = Schema.Struct({
  modelId: Schema.String,
  timeSeries: Schema.Array(Schema.Struct({
    time: Schema.Number,
    stocks: Schema.Record(Schema.String, Schema.Number),
    flows: Schema.Record(Schema.String, Schema.Number),
    variables: Schema.Record(Schema.String, Schema.Number)
  })),
  summary: Schema.Struct({
    equilibriumReached: Schema.Boolean,
    equilibriumTime: Schema.optional(Schema.Number),
    finalStockValues: Schema.Record(Schema.String, Schema.Number),
    oscillations: Schema.Boolean
  })
})

export const Simulate = Tool.make("Simulate", {
  description: "Run system dynamics simulation and return time series",
  parameters: SimulateParams,
  success: SimulationResult,
  failure: Schema.Never
})
```

#### handler implementation

```typescript
import { SystemDynamicsSolver } from "@org/effect-system-dynamics/Solver"
import { ModelRepo } from "@org/effect-system-dynamics/ModelRepo"

const handleSimulate = (params: typeof SimulateParams.Type) =>
  Effect.gen(function* () {
    const repo = yield* ModelRepo
    const solver = yield* SystemDynamicsSolver

    // load model from spanner
    const model = yield* repo.getModel(params.modelId)

    // apply parameter overrides
    const configuredModel = {
      ...model,
      stocks: model.stocks.map(stock => ({
        ...stock,
        initialValue: params.parameterOverrides?.[stock.id] ?? stock.initialValue
      }))
    }

    // run simulation
    const timeStep = params.timeStep ?? (params.timeEnd / 100)
    const solverMethod = params.solver ?? "euler"

    const timeSeries = yield* solver.simulate({
      model: configuredModel,
      timeEnd: params.timeEnd,
      timeStep,
      method: solverMethod
    })

    // analyze for equilibrium
    const summary = yield* analyzeSimulationResults(timeSeries)

    return {
      modelId: params.modelId,
      timeSeries,
      summary
    }
  })
```

---

### 3. sensitivity analysis tool

**purpose**: vary parameters across ranges, report impact on outcomes

#### schema definition

```typescript
const SensitivityAnalysisParams = Schema.Struct({
  modelId: Schema.String,
  targetMetric: Schema.String.pipe(
    Schema.annotations({
      description: "Stock or variable to measure (e.g., 'stocks.population')"
    })
  ),
  metricTime: Schema.Number.pipe(
    Schema.annotations({
      description: "Time point to sample metric (often end time)"
    })
  ),
  parameterRanges: Schema.Record(
    Schema.String,
    Schema.Struct({
      min: Schema.Number,
      max: Schema.Number,
      steps: Schema.Number
    })
  ).pipe(
    Schema.annotations({
      description: "Parameters to vary with ranges (e.g., {'stocks.initial_pop': {min: 100, max: 1000, steps: 10}})"
    })
  )
})

const SensitivityResult = Schema.Struct({
  targetMetric: Schema.String,
  impacts: Schema.Array(Schema.Struct({
    parameter: Schema.String,
    parameterValue: Schema.Number,
    metricValue: Schema.Number,
    percentChangeFromBaseline: Schema.Number
  })),
  ranking: Schema.Array(Schema.Struct({
    parameter: Schema.String,
    sensitivity: Schema.Number, // absolute change per unit change in parameter
    description: Schema.String
  }))
})

export const SensitivityAnalysis = Tool.make("SensitivityAnalysis", {
  description: "Perform sensitivity analysis by varying parameters and measuring impact",
  parameters: SensitivityAnalysisParams,
  success: SensitivityResult,
  failure: Schema.Never
})
```

#### handler implementation

```typescript
const handleSensitivityAnalysis = (params: typeof SensitivityAnalysisParams.Type) =>
  Effect.gen(function* () {
    const solver = yield* SystemDynamicsSolver
    const repo = yield* ModelRepo

    const model = yield* repo.getModel(params.modelId)

    // baseline simulation
    const baseline = yield* solver.simulate({
      model,
      timeEnd: params.metricTime,
      timeStep: params.metricTime / 100
    })
    const baselineValue = extractMetricValue(baseline, params.targetMetric, params.metricTime)

    // vary each parameter
    const impacts = yield* Effect.all(
      Object.entries(params.parameterRanges).flatMap(([param, range]) => {
        const values = linspace(range.min, range.max, range.steps)
        return values.map(value =>
          Effect.gen(function* () {
            const result = yield* solver.simulate({
              model: applyOverride(model, param, value),
              timeEnd: params.metricTime,
              timeStep: params.metricTime / 100
            })
            const metricValue = extractMetricValue(result, params.targetMetric, params.metricTime)
            return {
              parameter: param,
              parameterValue: value,
              metricValue,
              percentChangeFromBaseline: ((metricValue - baselineValue) / baselineValue) * 100
            }
          })
        )
      }),
      { concurrency: 10 } // parallel simulations
    )

    // rank parameters by sensitivity
    const ranking = computeSensitivityRanking(impacts, baselineValue)

    return {
      targetMetric: params.targetMetric,
      impacts,
      ranking
    }
  })
```

---

### 4. optimize parameters tool

**purpose**: search parameter space to achieve target outcome

#### schema definition

```typescript
const OptimizeParams = Schema.Struct({
  modelId: Schema.String,
  targetMetric: Schema.String,
  targetValue: Schema.Number,
  metricTime: Schema.Number,
  searchSpace: Schema.Record(
    Schema.String,
    Schema.Struct({
      min: Schema.Number,
      max: Schema.Number
    })
  ).pipe(
    Schema.annotations({
      description: "Parameters to optimize with bounds"
    })
  ),
  maxIterations: Schema.optional(Schema.Number).pipe(
    Schema.annotations({
      description: "Maximum optimization iterations (default: 100)"
    })
  )
})

const OptimizeResult = Schema.Struct({
  success: Schema.Boolean,
  bestParameters: Schema.Record(Schema.String, Schema.Number),
  achievedValue: Schema.Number,
  targetValue: Schema.Number,
  error: Schema.Number,
  iterations: Schema.Number
})

export const OptimizeParameters = Tool.make("OptimizeParameters", {
  description: "Find parameter values that achieve target metric value",
  parameters: OptimizeParams,
  success: OptimizeResult,
  failure: Schema.Never
})
```

#### handler implementation

```typescript
import { NelderMead } from "@org/effect-system-dynamics/Optimization"

const handleOptimizeParameters = (params: typeof OptimizeParams.Type) =>
  Effect.gen(function* () {
    const solver = yield* SystemDynamicsSolver
    const repo = yield* ModelRepo
    const optimizer = yield* NelderMead

    const model = yield* repo.getModel(params.modelId)

    // objective function: minimize squared error
    const objective = (paramValues: Record<string, number>) =>
      Effect.gen(function* () {
        const result = yield* solver.simulate({
          model: applyOverrides(model, paramValues),
          timeEnd: params.metricTime,
          timeStep: params.metricTime / 100
        })
        const achieved = extractMetricValue(result, params.targetMetric, params.metricTime)
        return Math.pow(achieved - params.targetValue, 2)
      })

    // run optimization
    const solution = yield* optimizer.minimize({
      objective,
      searchSpace: params.searchSpace,
      maxIterations: params.maxIterations ?? 100
    })

    return {
      success: solution.error < 0.01, // 1% tolerance
      bestParameters: solution.parameters,
      achievedValue: params.targetValue - Math.sqrt(solution.error),
      targetValue: params.targetValue,
      error: solution.error,
      iterations: solution.iterations
    }
  })
```

---

### 5. explain dynamics tool

**purpose**: generate natural language explanation of simulation behavior

#### schema definition

```typescript
const ExplainDynamicsParams = Schema.Struct({
  modelId: Schema.String,
  simulationResult: Schema.optional(SimulationResult).pipe(
    Schema.annotations({
      description: "Pre-computed simulation (if not provided, will run simulation)"
    })
  ),
  focusAreas: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.annotations({
      description: "Specific stocks/flows/variables to focus explanation on"
    })
  )
})

const DynamicsExplanation = Schema.Struct({
  summary: Schema.String.pipe(
    Schema.annotations({
      description: "High-level summary of system behavior"
    })
  ),
  keyInsights: Schema.Array(Schema.String),
  feedbackLoops: Schema.Array(Schema.Struct({
    type: Schema.Literal("reinforcing", "balancing"),
    description: Schema.String,
    strength: Schema.Literal("weak", "moderate", "strong")
  })),
  criticalPoints: Schema.Array(Schema.Struct({
    time: Schema.Number,
    event: Schema.String,
    cause: Schema.String
  })),
  recommendations: Schema.Array(Schema.String).pipe(
    Schema.annotations({
      description: "Suggested interventions or parameter adjustments"
    })
  )
})

export const ExplainDynamics = Tool.make("ExplainDynamics", {
  description: "Generate natural language explanation of system dynamics behavior",
  parameters: ExplainDynamicsParams,
  success: DynamicsExplanation,
  failure: Schema.Never
})
```

#### llm prompt template

```typescript
/**
 * prompt for dynamics explanation
 * uses chain-of-thought reasoning to identify patterns
 */
export const buildExplanationPrompt = (
  model: ModelStructure,
  simulation: SimulationResult,
  focusAreas?: string[]
) => ({
  system: `You are an expert system dynamics analyst. Explain simulation results in clear language.

ANALYSIS STEPS:
1. Identify dominant feedback loops (reinforcing vs balancing)
2. Spot critical transitions or tipping points
3. Explain causality between variables
4. Suggest leverage points for intervention

OUTPUT: Structured explanation matching DynamicsExplanation schema.`,

  user: `Explain the dynamics of this system:

MODEL STRUCTURE:
${JSON.stringify(model, null, 2)}

SIMULATION RESULTS:
Time horizon: ${simulation.timeSeries[simulation.timeSeries.length - 1].time}
Equilibrium reached: ${simulation.summary.equilibriumReached}
${simulation.summary.equilibriumTime ? `Equilibrium time: ${simulation.summary.equilibriumTime}` : ''}
Oscillations: ${simulation.summary.oscillations}

STOCK TRAJECTORIES:
${formatTimeSeries(simulation.timeSeries, focusAreas)}

${focusAreas ? `Focus explanation on: ${focusAreas.join(', ')}` : ''}

Provide:
1. Summary of overall behavior
2. Key insights about system dynamics
3. Feedback loop identification
4. Critical points and transitions
5. Recommendations for control or optimization`
})

const formatTimeSeries = (series: any[], focusAreas?: string[]) => {
  // sample 10 evenly-spaced points for llm context efficiency
  const samples = series.filter((_, i) => i % Math.floor(series.length / 10) === 0)
  return samples.map(s =>
    `t=${s.time}: ${JSON.stringify(s.stocks)}`
  ).join('\n')
}
```

#### handler implementation

```typescript
const handleExplainDynamics = (params: typeof ExplainDynamicsParams.Type) =>
  Effect.gen(function* () {
    const llm = yield* LanguageModel.LanguageModel
    const repo = yield* ModelRepo
    const solver = yield* SystemDynamicsSolver

    const model = yield* repo.getModel(params.modelId)

    // run simulation if not provided
    const simulation = params.simulationResult ??
      (yield* solver.simulate({
        model,
        timeEnd: 100,
        timeStep: 1
      }))

    const prompt = buildExplanationPrompt(model, simulation, params.focusAreas)

    const response = yield* llm.generateObject({
      prompt: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      schema: DynamicsExplanation
    })

    return response.value
  })
```

---

## toolkit assembly

**assemble all tools into unified toolkit**

```typescript
import { Toolkit } from "@effect/ai"

export const SystemDynamicsToolkit = Toolkit.make(
  GenerateModel,
  Simulate,
  SensitivityAnalysis,
  OptimizeParameters,
  ExplainDynamics
)

/**
 * layer providing tool handlers
 * dependencies: LanguageModel, SpannerGraphClient, SystemDynamicsSolver
 */
export const SystemDynamicsToolHandlers = SystemDynamicsToolkit.toLayer(
  Effect.gen(function* () {
    return {
      GenerateModel: handleGenerateModel,
      Simulate: handleSimulate,
      SensitivityAnalysis: handleSensitivityAnalysis,
      OptimizeParameters: handleOptimizeParameters,
      ExplainDynamics: handleExplainDynamics
    }
  })
)
```

---

## integration patterns

### pattern 1: agentic workflow (multi-step tool calling)

**scenario**: user asks "what population policy maximizes gdp in 50 years?"

```typescript
import { LanguageModel } from "@effect/ai"

const agenticAnalysis = (userQuery: string) =>
  Effect.gen(function* () {
    const llm = yield* LanguageModel.LanguageModel

    const response = yield* llm.generateText({
      prompt: userQuery,
      toolkit: SystemDynamicsToolkit,
      maxToolRounds: 5 // allow multi-step reasoning
    })

    return response
  }).pipe(
    Effect.provide(SystemDynamicsToolHandlers)
  )

// example execution flow:
// 1. llm calls GenerateModel("population-gdp system")
// 2. llm calls Simulate(model) with baseline params
// 3. llm calls SensitivityAnalysis targeting gdp at t=50
// 4. llm calls OptimizeParameters to maximize gdp
// 5. llm calls ExplainDynamics on optimized scenario
// 6. llm synthesizes natural language answer
```

### pattern 2: batch scenario exploration

**scenario**: run 100 "what-if" scenarios in parallel

```typescript
const exploreScenarios = (modelId: string, scenarios: Array<{
  name: string
  overrides: Record<string, number>
}>) =>
  Effect.gen(function* () {
    const results = yield* Effect.all(
      scenarios.map(scenario =>
        handleSimulate({
          modelId,
          timeEnd: 100,
          parameterOverrides: scenario.overrides
        }).pipe(
          Effect.map(result => ({
            name: scenario.name,
            result
          }))
        )
      ),
      { concurrency: 20 }
    )

    // llm summarizes differences
    const llm = yield* LanguageModel.LanguageModel
    const summary = yield* llm.generateText({
      prompt: `Compare these ${scenarios.length} scenarios and rank by outcome:\n${JSON.stringify(results, null, 2)}`
    })

    return { results, summary: summary.text }
  })
```

### pattern 3: ogp integration (outcome graph planner)

**use case**: user defines outcome "achieve 1M users", llm generates system dynamics model to understand growth dynamics, creates actions targeting high-leverage parameters

```typescript
import { OutcomeRepo } from "@org/server/domain/ogp/services/outcome-repo"
import { ActionRepo } from "@org/server/domain/ogp/services/action-repo"

const planOutcomeWithDynamics = (outcomeId: string) =>
  Effect.gen(function* () {
    const outcomeRepo = yield* OutcomeRepo
    const actionRepo = yield* ActionRepo
    const llm = yield* LanguageModel.LanguageModel

    const outcome = yield* outcomeRepo.get(outcomeId)

    // step 1: generate dynamics model
    const model = yield* handleGenerateModel({
      description: `Model the system dynamics for achieving: ${outcome.title}\n\nSuccess criteria: ${outcome.successCriteria}`,
      domains: outcome.domains
    })

    // step 2: run sensitivity analysis
    const sensitivity = yield* handleSensitivityAnalysis({
      modelId: model.modelId,
      targetMetric: "stocks.users", // inferred from outcome
      metricTime: 365,
      parameterRanges: {
        // llm suggests parameters to vary
      }
    })

    // step 3: create actions for top 3 leverage points
    const actions = yield* Effect.all(
      sensitivity.ranking.slice(0, 3).map(leverage =>
        actionRepo.create({
          title: `Optimize ${leverage.parameter}`,
          gapFilled: `Increase ${leverage.parameter} to accelerate ${outcome.title}`,
          userId: outcome.userId,
          domains: outcome.domains
        })
      )
    )

    // step 4: create CLOSES_GAP edges
    yield* Effect.all(
      actions.map(action =>
        createEdge({
          from: action.id,
          to: outcomeId,
          type: "CLOSES_GAP"
        })
      )
    )

    return { model, actions, sensitivity }
  })
```

---

## use case scenarios

### use case 1: novice modeler (democratization)

**user**: "i want to model climate change impacts on agriculture"

**system**:
1. calls `GenerateModel` with prompt
2. llm creates stocks (temperature, co2, crop_yield, investment) and flows (emissions, adaptation_spending)
3. calls `Simulate` with baseline params
4. calls `ExplainDynamics` to show feedback loops (e.g., "higher temps reduce yield → less investment → worse adaptation")
5. user tweaks via natural language: "what if we double adaptation spending?"
6. calls `Simulate` with override
7. compares results visually in xyflow

**outcome**: user builds sophisticated model without knowing differential equations

---

### use case 2: expert analyst (acceleration)

**user**: "find the minimum carbon price that keeps warming under 2°C by 2100"

**system**:
1. loads existing climate-economy model from graph
2. calls `OptimizeParameters` targeting temperature stock
3. runs 50 iterations of nelder-mead optimization
4. finds carbon_price=$125/ton achieves target
5. calls `SensitivityAnalysis` to check robustness
6. reports "carbon price is most sensitive to discount_rate assumption"

**outcome**: what took weeks of manual iteration happens in 30 seconds

---

### use case 3: executive dashboard (explanation)

**user**: dashboard shows unexpected decline in customer retention simulation

**system**:
1. dashboard triggers `ExplainDynamics` on retention model
2. llm identifies: "balancing feedback loop between churn and support_investment weakened at t=18 due to budget_cuts parameter"
3. llm recommends: "increase support_investment by 20% to restore equilibrium"
4. user approves, system updates model params
5. re-simulates with new params, retention recovers

**outcome**: non-technical execs understand system behavior and make informed decisions

---

## mcp protocol integration

**model context protocol** enables system dynamics tools as standalone mcp servers

### mcp server implementation

```typescript
import { McpServer } from "@effect/ai"
import { Layer } from "effect"

/**
 * expose system dynamics toolkit as mcp server
 * allows any mcp client (claude desktop, cursor, etc) to call simulation tools
 */
export const SystemDynamicsMcpServer = McpServer.make({
  name: "system-dynamics",
  version: "1.0.0",
  description: "System dynamics modeling and simulation tools"
}).pipe(
  McpServer.addToolkit(SystemDynamicsToolkit)
)

/**
 * layer stack for mcp server
 */
export const SystemDynamicsMcpLayer = Layer.mergeAll(
  OpenAiClientLayer,
  SpannerGraphClientLayer,
  SystemDynamicsSolverLayer,
  SystemDynamicsToolHandlers
).pipe(
  Layer.provide(SystemDynamicsMcpServer)
)

/**
 * run server
 */
const program = McpServer.serve(SystemDynamicsMcpServer).pipe(
  Effect.provide(SystemDynamicsMcpLayer)
)

Effect.runPromise(program)
```

### mcp manifest (for claude desktop)

```json
{
  "mcpServers": {
    "system-dynamics": {
      "command": "node",
      "args": ["/path/to/effect-system-dynamics/mcp-server.js"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "SPANNER_PROJECT_ID": "project",
        "SPANNER_INSTANCE_ID": "instance",
        "SPANNER_DATABASE_ID": "database"
      }
    }
  }
}
```

now users can ask claude desktop: "simulate a predator-prey model with 100 rabbits and 10 wolves" and it calls your mcp tools.

---

## effect.ai workflow diagrams

### diagram 1: single-shot model generation

```
user input (natural language)
  ↓
LanguageModel.generateObject (with GenerateModel tool)
  ↓
validate equations (Effect.gen)
  ↓
persist to spanner (SpannerGraphClient)
  ↓
return modelId + structure
```

### diagram 2: agentic multi-step analysis

```
user query ("optimize X to achieve Y")
  ↓
LanguageModel.generateText (with full toolkit)
  ↓
[llm autonomously calls tools in loop]
  ├─ GenerateModel (if no model exists)
  ├─ Simulate (baseline)
  ├─ SensitivityAnalysis (find leverage points)
  ├─ OptimizeParameters (search for solution)
  └─ ExplainDynamics (interpret results)
  ↓
llm synthesizes final answer (natural language)
  ↓
return to user
```

### diagram 3: streaming simulation with ai commentary

```
user starts simulation
  ↓
Effect.Stream (timesteps)
  ├─ solve ode step (euler/rk4)
  ├─ emit state update
  └─ [every 10 steps] LanguageModel.streamText (commentary)
  ↓
user sees live graph + ai narration in parallel
```

---

## code organization

### directory structure

```
packages/effect-system-dynamics/
├── src/
│   ├── Model.ts              # stock/flow/variable schemas
│   ├── Solver.ts             # euler, rk4, adaptive solvers
│   ├── ModelRepo.ts          # spanner graph persistence
│   ├── Optimization.ts       # nelder-mead, gradient descent
│   ├── Analysis.ts           # sensitivity, equilibrium detection
│   └── ai/
│       ├── Tools.ts          # tool definitions (this doc's schemas)
│       ├── Toolkit.ts        # assembled toolkit + handlers
│       ├── Prompts.ts        # llm prompt templates
│       └── McpServer.ts      # mcp protocol server
├── docs/
│   └── research/
│       └── agent-d-ai-integration.md  # this document
└── test/
    └── ai/
        ├── tools.test.ts
        └── integration.test.ts
```

---

## related research

### papers

1. **"Leveraging Large Language Models for Automated Causal Loop Diagram Generation"** (2025)
   arxiv.org/abs/2503.21798
   - curated prompting achieves expert-level cld quality
   - we apply this to full stock-flow generation

2. **"From text to map: a system dynamics bot for constructing causal loop diagrams"** (2024)
   onlinelibrary.wiley.com/doi/full/10.1002/sdr.1782
   - gpt-4 identifies 56% of relationships humans found
   - feedback loops match in 83% of cases
   - validates llm capability for dynamics modeling

3. **"LLM-Powered, Expert-Refined Causal Loop Diagramming via Pipeline Algebra"** (2025)
   mdpi.com/2079-8954/13/9/784
   - multi-stage pipeline: extraction → mining → polarity → synthesis
   - expert validation + iteration loop
   - we automate this with schema-validated tool outputs

### effect.ai resources

- **effect docs**: effect.website/docs/ai/introduction
- **tool use guide**: effect.website/docs/ai/tool-use
- **@effect/ai-openai**: npmjs.com/package/@effect/ai-openai

---

## next steps

1. **implement core solver** (packages/effect-system-dynamics/src/Solver.ts)
   - euler integration with configurable timestep
   - schema for model definition

2. **implement tool handlers** (packages/effect-system-dynamics/src/ai/Tools.ts)
   - start with GenerateModel + Simulate
   - test with known models (predator-prey, sir epidemic)

3. **build mcp server** (packages/effect-system-dynamics/src/ai/McpServer.ts)
   - expose toolkit via mcp protocol
   - test with claude desktop

4. **integrate with ogp** (packages/server/src/domain/system-dynamics/)
   - outcome → dynamics model mapping
   - sensitivity → action generation
   - persist models as graph nodes

5. **xyflow visualization** (packages/client/src/features/system-dynamics/)
   - render stock-flow diagrams
   - live simulation overlay with streaming state
   - ai commentary sidebar

---

## conclusion

integrating llms with system dynamics makes the library **10x more accessible** (novices build models in natural language), **10x faster** (ai explores scenarios in seconds), and **10x more understandable** (explanations bridge math to intuition).

the effect.ai toolkit pattern gives us type-safe, composable tools. the mcp protocol makes tools universally accessible. the graph storage in spanner enables causal reasoning across planning (ogp) and dynamics (stocks/flows).

this is the future of modeling: ai-native, graph-native, effect-native.
