# System Dynamics Stock-Flow Diagrams: Graph Schema + XYFlow Integration

**Research Date**: 2025-10-30
**Codebase**: lever monorepo
**Target**: Cloud Spanner Graph + XYFlow visualization

## Executive Summary

this doc specifies how to model system dynamics stock-flow diagrams as first-class graph entities in spanner's schemaless graph database and render them with xyflow custom nodes. all patterns align with lever's existing ogp graph architecture.

**key insight**: stocks are nodes, flows are *edges with properties*, not nodes. this matches the mathematical model where flows are rate functions between stocks.

---

## 1. System Dynamics Primer

### 1.1 Core Concepts

| Element | Type | Purpose | Visual |
|---------|------|---------|--------|
| **Stock** | Node | Accumulated quantity (state variable) | Rectangle |
| **Flow** | Edge | Rate of change between stocks | Pipe with valve |
| **Variable** | Node | Computed value (auxiliary) | Circle |
| **Parameter** | Node | Constant/user input | Diamond |
| **Source/Sink** | Virtual | Infinite reservoir | Cloud |
| **Link** | Edge | Information dependency | Dashed arrow |

### 1.2 Mathematical Model

**Stock accumulation**:
```
Stock(t) = Stock(t-1) + ∫[Inflow(t) - Outflow(t)]dt
```

**Flow equation**:
```
Flow(t) = f(Stocks, Variables, Parameters)
```

**Variable computation**:
```
Variable(t) = g(Stocks, Variables, Parameters)
```

### 1.3 Example: Population Model

```
Births (flow) → Population (stock) → Deaths (flow)
                      ↑
                BirthRate (variable) influences Births
                DeathRate (variable) influences Deaths
```

---

## 2. Graph Schema Design

### 2.1 Node Types

#### Stock Node

```typescript
// packages/effect-system-dynamics/src/nodes/stock.ts
import { Schema } from "effect";
import { StockId } from "../types.js";

/**
 * Stock - accumulated quantity (state variable)
 *
 * Represents inventory, population, money, etc that accumulates over time.
 * Updated via inflow/outflow edges.
 *
 * Stored in Spanner GraphNode with label="stock"
 */
export class Stock extends Schema.Class<Stock>("Stock")({
  label: Schema.Literal("stock"),
  id: StockId,

  /** Display name */
  title: Schema.String,

  /** Current accumulated value */
  current_value: Schema.Number,

  /** Initial value at t=0 */
  initial_value: Schema.Number,

  /** Units (e.g., "people", "dollars", "widgets") */
  units: Schema.String,

  /** Measurement type (discrete/continuous) */
  measurement_type: Schema.Literal("discrete", "continuous"),

  /** Min/max bounds (optional constraints) */
  bounds: Schema.optional(Schema.Struct({
    min: Schema.NullOr(Schema.Number),
    max: Schema.NullOr(Schema.Number),
  })),

  /** UI layout state */
  visual_state: Schema.optional(Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  })),

  created_at: Schema.DateTimeUtc,
  updated_at: Schema.DateTimeUtc,
}) {}
```

#### Variable Node

```typescript
// packages/effect-system-dynamics/src/nodes/variable.ts

/**
 * Variable - computed auxiliary value
 *
 * Derived from stocks/other variables via formula.
 * Can be converter (algebraic) or constant (parameter).
 *
 * Stored in Spanner GraphNode with label="variable"
 */
export class Variable extends Schema.Class<Variable>("Variable")({
  label: Schema.Literal("variable"),
  id: VariableId,

  title: Schema.String,

  /** Variable type */
  variable_type: Schema.Literal("converter", "constant"),

  /** Formula for converters (e.g., "birth_rate * population") */
  formula: Schema.optional(Schema.String),

  /** Fixed value for constants */
  constant_value: Schema.optional(Schema.Number),

  /** Current computed value */
  current_value: Schema.Number,

  units: Schema.String,

  visual_state: Schema.optional(Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    radius: Schema.Number, // circles for variables
  })),

  created_at: Schema.DateTimeUtc,
  updated_at: Schema.DateTimeUtc,
}) {}
```

#### Parameter Node

```typescript
// packages/effect-system-dynamics/src/nodes/parameter.ts

/**
 * Parameter - user-adjustable constant
 *
 * Slider/input-controllable value that affects flows/variables.
 * Distinguished from constant Variables for UI purposes.
 *
 * Stored in Spanner GraphNode with label="parameter"
 */
export class Parameter extends Schema.Class<Parameter>("Parameter")({
  label: Schema.Literal("parameter"),
  id: ParameterId,

  title: Schema.String,

  /** Current value */
  value: Schema.Number,

  /** Default value */
  default_value: Schema.Number,

  /** Slider bounds */
  range: Schema.Struct({
    min: Schema.Number,
    max: Schema.Number,
    step: Schema.Number,
  }),

  units: Schema.String,

  /** Description shown in UI */
  description: Schema.optional(Schema.String),

  visual_state: Schema.optional(Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
  })),

  created_at: Schema.DateTimeUtc,
  updated_at: Schema.DateTimeUtc,
}) {}
```

### 2.2 Edge Types

#### Flow Edge (Stock → Stock)

```typescript
// packages/effect-system-dynamics/src/edges/flow.ts

/**
 * Flow - rate of change between stocks
 *
 * Represents material/information transfer rate.
 * Source/target can be stock nodes OR virtual cloud nodes.
 * Formula computes rate as f(stocks, variables, parameters).
 *
 * Stored in Spanner GraphEdge with label="flow"
 */
export class FlowEdge extends Schema.Class<FlowEdge>("FlowEdge")({
  label: Schema.Literal("flow"),
  id: FlowEdgeId,

  /** Source stock (or "cloud" for infinite source) */
  from: Schema.Union(StockId, Schema.Literal("cloud")),

  /** Target stock (or "cloud" for infinite sink) */
  to: Schema.Union(StockId, Schema.Literal("cloud")),

  /** Display name */
  title: Schema.String,

  /** Flow type */
  flow_type: Schema.Literal("inflow", "outflow", "biflow"),

  /** Rate formula (e.g., "birth_rate * population") */
  formula: Schema.String,

  /** Current computed rate */
  current_rate: Schema.Number,

  units: Schema.String, // e.g., "people/year"

  /** Delay if flow has lag */
  delay: Schema.optional(Schema.Struct({
    duration: Schema.Number,
    type: Schema.Literal("material", "information"),
  })),

  created_at: Schema.DateTimeUtc,
}) {}
```

#### Link Edge (Any → Any)

```typescript
// packages/effect-system-dynamics/src/edges/link.ts

/**
 * Link - information dependency
 *
 * Shows that source influences target's computation.
 * Does NOT transfer material/quantity (unlike flows).
 *
 * Stored in Spanner GraphEdge with label="link"
 */
export class LinkEdge extends Schema.Class<LinkEdge>("LinkEdge")({
  label: Schema.Literal("link"),
  id: LinkEdgeId,

  /** Source node (stock/variable/parameter) */
  from: Schema.String, // generic node ID

  /** Target node (flow/variable) */
  to: Schema.String,

  /** Link polarity (+ or -) */
  polarity: Schema.Literal("positive", "negative"),

  created_at: Schema.DateTimeUtc,
}) {}
```

### 2.3 Schema Transforms (camelCase ↔ snake_case)

using `Schema.transform` for bidirectional spanner encoding:

```typescript
// Example: Stock with transforms
const StockEncoded = Schema.Struct({
  id: StockId,
  current_value: Schema.Number,
  initial_value: Schema.Number,
  measurement_type: Schema.Literal("discrete", "continuous"),
  visual_state: Schema.optional(Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  })),
  // ... other snake_case fields
});

const StockDomain = Schema.Struct({
  id: StockId,
  currentValue: Schema.Number,
  initialValue: Schema.Number,
  measurementType: Schema.Literal("discrete", "continuous"),
  visualState: Schema.optional(Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  })),
  // ... other camelCase fields
});

export const Stock = StockDomain.pipe(
  Schema.transform(
    StockEncoded,
    {
      decode: (db) => ({
        id: db.id,
        currentValue: db.current_value,
        initialValue: db.initial_value,
        measurementType: db.measurement_type,
        visualState: db.visual_state,
        // ...
      }),
      encode: (domain) => ({
        id: domain.id,
        current_value: domain.currentValue,
        initial_value: domain.initialValue,
        measurement_type: domain.measurementType,
        visual_state: domain.visualState,
        // ...
      }),
    },
  ),
);
```

---

## 3. XYFlow Custom Nodes

### 3.1 Stock Node Component

```typescript
// packages/client/src/components/sd/stock-node.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BaseNode, BaseNodeContent, BaseNodeHeader, BaseNodeHeaderTitle } from "@/components/base-node";
import { Badge } from "@/components/ui/badge";
import { useAtomSet } from "@effect-atom/atom-react";
import { updateStockAtom } from "@/atoms/sd/stock-atoms";
import { Database } from "lucide-react";
import React from "react";

type StockNodeData = {
  label: string;
  currentValue: number;
  units: string;
  entity: typeof Stock.Type;
};

export function StockNode({
  id,
  data,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: NodeProps<StockNodeData>) {
  const updateStock = useAtomSet(updateStockAtom, { mode: "promise" });
  const labelRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = React.useCallback(
    async (e: React.FocusEvent<HTMLDivElement>) => {
      const newText = e.currentTarget.textContent?.trim() || "";
      if (newText && newText !== data.label) {
        await updateStock({ id, updates: { title: newText } });
      }
    },
    [id, data.label, updateStock],
  );

  return (
    <BaseNode className="min-w-[200px] border-2 border-blue-600 rounded-sm">
      {/* Inflow handle (left) */}
      <Handle
        type="target"
        id="inflow"
        position={targetPosition}
        style={{ background: "#22c55e" }}
      />

      <BaseNodeHeader className="bg-blue-50">
        <div className="flex items-center gap-2 w-full">
          <Database className="h-4 w-4 text-blue-600" />
          <BaseNodeHeaderTitle className="text-sm">Stock</BaseNodeHeaderTitle>
        </div>
      </BaseNodeHeader>

      <BaseNodeContent className="space-y-2">
        <div
          ref={labelRef}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleBlur}
          className="text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-blue-500 nodrag cursor-text"
        >
          {data.label}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-blue-700">
            {data.currentValue.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">{data.units}</span>
        </div>
      </BaseNodeContent>

      {/* Outflow handle (right) */}
      <Handle
        type="source"
        id="outflow"
        position={sourcePosition}
        style={{ background: "#ef4444" }}
      />
    </BaseNode>
  );
}
```

### 3.2 Variable Node Component

```typescript
// packages/client/src/components/sd/variable-node.tsx

type VariableNodeData = {
  label: string;
  currentValue: number;
  units: string;
  variableType: "converter" | "constant";
  entity: typeof Variable.Type;
};

export function VariableNode({ id, data }: NodeProps<VariableNodeData>) {
  return (
    <BaseNode className="rounded-full w-24 h-24 border-2 border-purple-500 flex items-center justify-center">
      <BaseNodeContent className="text-center">
        <div className="text-xs font-medium">{data.label}</div>
        <div className="text-lg font-bold text-purple-700">
          {data.currentValue.toFixed(1)}
        </div>
        <div className="text-[10px] text-muted-foreground">{data.units}</div>
      </BaseNodeContent>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "#a855f7" }}
      />
    </BaseNode>
  );
}
```

### 3.3 Parameter Node Component

```typescript
// packages/client/src/components/sd/parameter-node.tsx

type ParameterNodeData = {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  units: string;
  entity: typeof Parameter.Type;
};

export function ParameterNode({ id, data }: NodeProps<ParameterNodeData>) {
  const updateParam = useAtomSet(updateParameterAtom, { mode: "promise" });
  const [localValue, setLocalValue] = React.useState(data.value);

  const handleChange = async (newValue: number) => {
    setLocalValue(newValue);
    await updateParam({ id, updates: { value: newValue } });
  };

  return (
    <BaseNode className="min-w-[180px] border-2 border-amber-500 diamond-shape">
      <BaseNodeContent className="space-y-2">
        <div className="text-xs font-medium text-center">{data.label}</div>

        <input
          type="range"
          min={data.range.min}
          max={data.range.max}
          step={data.range.step}
          value={localValue}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="w-full nodrag"
        />

        <div className="text-center">
          <span className="text-lg font-bold text-amber-700">{localValue}</span>
          <span className="text-xs text-muted-foreground ml-1">{data.units}</span>
        </div>
      </BaseNodeContent>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "#f59e0b" }}
      />
    </BaseNode>
  );
}
```

### 3.4 Custom Flow Edge

```typescript
// packages/client/src/components/sd/flow-edge.tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

type FlowEdgeData = {
  label: string;
  currentRate: number;
  units: string;
  flowType: "inflow" | "outflow" | "biflow";
};

export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FlowEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color = data.flowType === "inflow" ? "#22c55e" : "#ef4444";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 3,
        }}
      />

      {/* Valve symbol */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <div className="bg-white border-2 rounded px-2 py-1 text-xs shadow-md"
            style={{ borderColor: color }}
          >
            <div className="font-medium">{data.label}</div>
            <div className="text-[10px] text-muted-foreground">
              {data.currentRate.toFixed(2)} {data.units}
            </div>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

### 3.5 Node Type Registration

```typescript
// packages/client/src/features/system-dynamics/node-types.ts
import { StockNode } from "@/components/sd/stock-node";
import { VariableNode } from "@/components/sd/variable-node";
import { ParameterNode } from "@/components/sd/parameter-node";

export const sdNodeTypes = {
  stock: StockNode,
  variable: VariableNode,
  parameter: ParameterNode,
};

export const sdEdgeTypes = {
  flow: FlowEdge,
};
```

---

## 4. Data Flow Architecture

### 4.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│              Spanner Graph Database                      │
│  GraphNode (stocks, variables, parameters)              │
│  GraphEdge (flows, links)                               │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ GQL queries via SpannerGraphClient
                 ▼
┌─────────────────────────────────────────────────────────┐
│           Effect-Atom State Layer                        │
│                                                          │
│  Layer 1: Remote Atoms                                  │
│    - sdStocksAtom (query stocks)                        │
│    - sdVariablesAtom (query variables)                  │
│    - sdFlowEdgesAtom (query flows)                      │
│                                                          │
│  Layer 2: Managed ReactFlow State                       │
│    - reactFlowNodesAtom (writable, auto-sync)           │
│    - reactFlowEdgesAtom (writable, auto-sync)           │
│                                                          │
│  Layer 3: Simulation State                              │
│    - simulationStateAtom (t, running, history)          │
│    - simulationStepAtom (fn: advance one step)          │
│                                                          │
│  Layer 4: Mutations                                      │
│    - updateStockAtom (optimistic + rollback)            │
│    - createFlowAtom (temp edge → server)                │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ useAtomValue / useAtomSet
                 ▼
┌─────────────────────────────────────────────────────────┐
│              XYFlow Canvas Component                     │
│                                                          │
│  <ReactFlow                                              │
│    nodes={useAtomValue(reactFlowNodesAtom)}             │
│    edges={useAtomValue(reactFlowEdgesAtom)}             │
│    nodeTypes={sdNodeTypes}                              │
│    edgeTypes={sdEdgeTypes}                              │
│  />                                                      │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Simulation Integration

```typescript
// packages/effect-system-dynamics/src/simulation/state.ts

export type SimulationState = {
  /** Current time step */
  t: number;

  /** Delta time per step (e.g., 0.1 for dt=0.1) */
  dt: number;

  /** Is simulation running? */
  running: boolean;

  /** History of stock values over time */
  history: Map<StockId, number[]>;
};

// Writable atom for simulation state
export const simulationStateAtom = Atom.writable(
  (get): SimulationState => {
    const current = get.self<SimulationState>();
    return Option.getOrElse(current, () => ({
      t: 0,
      dt: 0.1,
      running: false,
      history: new Map(),
    }));
  },
  (ctx, action: SimulationAction) => {
    const current = ctx.get(simulationStateAtom);

    const next = SimulationAction.$match(action, {
      Start: () => ({ ...current, running: true }),
      Pause: () => ({ ...current, running: false }),
      Reset: () => ({
        t: 0,
        dt: current.dt,
        running: false,
        history: new Map(),
      }),
      Step: () => {
        // Advance simulation by one dt
        const nextT = current.t + current.dt;
        // ... compute new stock values via euler integration
        return { ...current, t: nextT };
      },
    });

    ctx.setSelf(next);
  },
);

// Function atom to run simulation loop
export const runSimulationAtom = runtime.fn(
  Effect.fnUntraced(function* (get: Atom.FnContext) {
    const state = get.get(simulationStateAtom);
    if (!state.running) return;

    // Get current stocks/flows
    const stocks = get.get(reactFlowNodesAtom).filter(n => n.type === "stock");
    const flows = get.get(reactFlowEdgesAtom).filter(e => e.type === "flow");

    // Compute derivatives (Euler integration)
    const derivatives = yield* Effect.sync(() =>
      computeDerivatives(stocks, flows, state.dt)
    );

    // Update stock values
    Atom.batch(() => {
      get.set(reactFlowNodesAtom, current =>
        current.map(node => {
          if (node.type !== "stock") return node;
          const delta = derivatives.get(node.id) ?? 0;
          return {
            ...node,
            data: {
              ...node.data,
              currentValue: node.data.currentValue + delta,
            },
          };
        })
      );

      // Advance time
      get.set(simulationStateAtom, { type: "Step" });
    });

    // Schedule next step if still running
    const nextState = get.get(simulationStateAtom);
    if (nextState.running) {
      yield* Effect.sleep("16 millis"); // ~60fps
      yield* get.set(runSimulationAtom, undefined);
    }
  }),
);
```

### 4.3 Live Data Overlays

```typescript
// packages/client/src/features/system-dynamics/simulation-panel.tsx

export function SimulationPanel() {
  const state = useAtomValue(simulationStateAtom);
  const runSim = useAtomSet(runSimulationAtom);
  const dispatch = useAtomSet(simulationStateAtom);

  const handleToggle = () => {
    if (state.running) {
      dispatch({ type: "Pause" });
    } else {
      dispatch({ type: "Start" });
      runSim(); // kick off loop
    }
  };

  return (
    <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2 shadow-sm">
      <Button onClick={handleToggle} size="sm">
        {state.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <Button onClick={() => dispatch({ type: "Reset" })} size="sm" variant="outline">
        <RotateCcw className="h-4 w-4" />
      </Button>

      <div className="text-sm text-muted-foreground ml-2">
        t = {state.t.toFixed(2)}
      </div>
    </div>
  );
}
```

---

## 5. Layout Algorithms

### 5.1 Hierarchical Layout (Dagre)

reuse existing dagre layout from ogp graph:

```typescript
// packages/client/src/features/system-dynamics/layout.ts
import Dagre from "@dagrejs/dagre";

export const getSDLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR",
) => {
  const graph = new Dagre.graphlib.Graph();

  graph.setGraph({
    rankdir: direction,
    nodesep: 80,  // wider spacing for stock boxes
    ranksep: 120, // more vertical space
    edgesep: 20,
    ranker: "tight-tree",
    align: "UL",
  });

  // Node sizes based on type
  nodes.forEach((node) => {
    const width = node.type === "stock" ? 200 : node.type === "variable" ? 100 : 180;
    const height = node.type === "stock" ? 100 : node.type === "variable" ? 100 : 80;

    graph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  Dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - position.width / 2,
        y: position.y - position.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};
```

### 5.2 Force-Directed Layout (d3-force)

for complex interconnected models:

```typescript
// packages/client/src/features/system-dynamics/force-layout.ts
import { forceSimulation, forceLink, forceManyBody, forceCenter } from "d3-force";

export const getForceLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
) => {
  const simulation = forceSimulation(nodes as any)
    .force("link", forceLink(edges).id((d: any) => d.id).distance(150))
    .force("charge", forceManyBody().strength(-300))
    .force("center", forceCenter(400, 300))
    .stop();

  // Run simulation for fixed iterations
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  const layoutedNodes = nodes.map((node, i) => ({
    ...node,
    position: {
      x: (simulation.nodes()[i] as any).x,
      y: (simulation.nodes()[i] as any).y,
    },
  }));

  return { nodes: layoutedNodes, edges };
};
```

---

## 6. Example Models

### 6.1 Simple Population Model

```
┌─────────┐  Births   ┌────────────┐  Deaths   ┌─────────┐
│ Cloud   │ ────────> │ Population │ ────────> │ Cloud   │
└─────────┘           └────────────┘           └─────────┘
                            ▲
                            │
                      ┌─────┴─────┐
                      │ BirthRate │
                      └───────────┘
```

**Nodes:**
- Stock: Population (initial: 1000, units: "people")
- Variable: BirthRate (formula: "0.03", units: "1/year")
- Variable: DeathRate (formula: "0.02", units: "1/year")

**Edges:**
- Flow: cloud → Population (formula: "BirthRate * Population", units: "people/year")
- Flow: Population → cloud (formula: "DeathRate * Population", units: "people/year")
- Link: BirthRate → Births flow
- Link: DeathRate → Deaths flow
- Link: Population → Births flow
- Link: Population → Deaths flow

### 6.2 Inventory Management Model

```
┌─────────┐  Orders  ┌───────────┐  Sales   ┌─────────┐
│ Factory │ ───────> │ Inventory │ ───────> │ Cloud   │
└─────────┘          └───────────┘          └─────────┘
                          ▲
                          │
                    ┌─────┴──────┐
                    │ ReorderPt  │
                    └────────────┘
```

---

## 7. Integration with Lever Architecture

### 7.1 Package Structure

```
packages/effect-system-dynamics/
├── src/
│   ├── nodes/
│   │   ├── stock.ts         # Stock schema
│   │   ├── variable.ts      # Variable schema
│   │   └── parameter.ts     # Parameter schema
│   ├── edges/
│   │   ├── flow.ts          # Flow edge schema
│   │   └── link.ts          # Link edge schema
│   ├── simulation/
│   │   ├── state.ts         # Simulation state atom
│   │   ├── engine.ts        # Euler integration
│   │   └── evaluator.ts     # Formula evaluation
│   ├── repository/
│   │   ├── stock-repo.ts    # Spanner CRUD for stocks
│   │   ├── flow-repo.ts     # Spanner CRUD for flows
│   │   └── model-repo.ts    # Load/save complete models
│   └── index.ts
├── docs/
│   └── research/
│       └── agent-c-graph-xyflow.md (this file)
└── package.json
```

### 7.2 Client Integration

```
packages/client/src/
├── atoms/sd/
│   ├── stock-atoms.ts       # Stock remote/mutation atoms
│   ├── variable-atoms.ts    # Variable atoms
│   ├── simulation-atoms.ts  # Simulation state + loop
│   └── sd-graph-atoms.ts    # Managed ReactFlow state
├── components/sd/
│   ├── stock-node.tsx       # Custom stock node
│   ├── variable-node.tsx    # Custom variable node
│   ├── parameter-node.tsx   # Custom parameter node
│   └── flow-edge.tsx        # Custom flow edge
└── features/system-dynamics/
    ├── SDGraphPage.tsx      # Main canvas page
    ├── SimulationPanel.tsx  # Play/pause controls
    ├── StockChart.tsx       # Time series chart
    └── ModelLibrary.tsx     # Pre-built model templates
```

### 7.3 Server Integration

```
packages/server/src/domain/sd/
├── services/
│   ├── stock-repo-sql.ts    # SpannerGraphClient.toRepo
│   ├── flow-repo-sql.ts
│   └── simulation-service.ts
├── sd-rpc-live.ts           # RPC handlers
└── endpoints.ts             # HttpApi group
```

---

## 8. Key Insights & Patterns

### 8.1 Why Flows Are Edges, Not Nodes

**mathematical**: flows are rate functions `F(S₁, S₂, t)` that depend on source/target stocks.

**performance**: edge traversal in spanner graph is optimized. querying "all inflows to stock X" is a single GQL query.

**visual**: pipes with valves are naturally rendered as edges with custom labels.

**simulation**: euler integration needs `dS/dt = Σ(inflows) - Σ(outflows)`. edge traversal gives this directly.

### 8.2 Schema.transform for Bidirectional Casing

all node/edge schemas use `Schema.transform` to convert between:
- **domain models** (camelCase, TypeScript idiomatic)
- **spanner storage** (snake_case, SQL convention)

this is automatic via `SpannerGraphClient` decode/encode.

### 8.3 Effect-Atom Managed ReactFlow State

leverage `Atom.writable` with `get.subscribe` for auto-sync:

```typescript
export const reactFlowNodesAtom = Atom.writable(
  (get) => {
    // Subscribe to remote changes
    get.subscribe(sdNodesAtom, (result) => {
      if (Result.isSuccess(result)) {
        get.setSelf(result.value);
      }
    });

    // Return current or initial
    const current = get.self<Node[]>();
    return Option.getOrElse(current, () => []);
  },
  (ctx, valueOrUpdater) => {
    const newValue = typeof valueOrUpdater === "function"
      ? valueOrUpdater(ctx.get(reactFlowNodesAtom))
      : valueOrUpdater;
    ctx.setSelf(newValue);
  },
);
```

**benefits:**
- single source of truth (atoms)
- no dual state (atoms + useNodesState)
- no manual sync useEffects
- automatic animations via position updates

### 8.4 Optimistic Updates with Rollback

mutation atoms use snapshot + rollback pattern:

```typescript
export const updateStockAtom = runtime.fn(
  Effect.fnUntraced(function* (payload, get) {
    const previous = get.get(reactFlowNodesAtom);

    // Optimistic update
    get.set(reactFlowNodesAtom, current =>
      current.map(n => n.id === payload.id ? { ...n, data: payload.data } : n)
    );

    // Server mutation
    const api = yield* SDClient;
    return yield* api.updateStock(payload).pipe(
      Effect.catchAll((error) => {
        // Rollback on error
        get.set(reactFlowNodesAtom, previous);
        return Effect.fail(error);
      })
    );
  }),
  { reactivityKeys: ["sd-graph"] },
);
```

### 8.5 Simulation Loop with Effect.sleep

simulation runs as function atom with recursive scheduling:

```typescript
export const runSimulationAtom = runtime.fn(
  Effect.fnUntraced(function* (get) {
    const state = get.get(simulationStateAtom);
    if (!state.running) return;

    // Compute one step
    yield* Effect.sync(() => simulateStep(state));

    // Update nodes
    get.set(reactFlowNodesAtom, /* updated values */);

    // Schedule next frame
    yield* Effect.sleep("16 millis");
    yield* get.set(runSimulationAtom, undefined); // recurse
  }),
);
```

---

## 9. XYFlow Documentation Links

### 9.1 Official Docs

- **Custom Nodes**: https://reactflow.dev/learn/customization/custom-nodes
- **Custom Edges**: https://reactflow.dev/learn/customization/custom-edges
- **Controlled Flow**: https://reactflow.dev/examples/interaction/controlled-flow
- **Node Types**: https://reactflow.dev/api-reference/types/node
- **Edge Types**: https://reactflow.dev/api-reference/types/edge
- **Handles**: https://reactflow.dev/api-reference/components/handle

### 9.2 Relevant Examples

- **Zustand State Management**: https://github.com/xyflow/xyflow/tree/main/examples/react/zustand
- **Stress Test (10k nodes)**: https://reactflow.dev/examples/nodes/stress
- **Animation**: https://reactflow.dev/examples/interaction/animation
- **Custom Handle Styles**: https://reactflow.dev/examples/styling/custom-connectionline

### 9.3 Lever Codebase References

- **Existing XYFlow Usage**: `/Users/ryanhunter/artimath/lever/packages/client/src/features/items/ItemGraphPage.tsx`
- **OGP Custom Nodes**: `/Users/ryanhunter/artimath/lever/packages/client/src/components/{action,outcome}-node.tsx`
- **Atom Patterns**: `/Users/ryanhunter/artimath/lever/packages/client/src/atoms/cognitive-graph-atoms.ts`
- **Architecture Guide**: `/Users/ryanhunter/artimath/lever/packages/client/src/features/items/idiomatic-xyflow-effect-atom-map.md`

---

## 10. Next Steps

### 10.1 Proof of Concept

1. **Create minimal schemas** (Stock, FlowEdge in domain package)
2. **Implement SpannerGraphClient repos** (stock-repo.ts, flow-repo.ts)
3. **Build StockNode + FlowEdge components** (reuse BaseNode patterns)
4. **Create SDGraphPage with managed atoms** (follow ItemGraphPage pattern)
5. **Add simple simulation loop** (euler integration for population model)

### 10.2 Production Features

1. **Formula parser** (parse "birth_rate * population" into AST)
2. **Variable dependency graph** (topological sort for evaluation order)
3. **Model serialization** (save/load complete SD models as JSON)
4. **Chart overlays** (real-time line charts for stock history)
5. **Model library** (pre-built templates: population, inventory, epidemiology)

### 10.3 Advanced Features

1. **Delay queues** (material/information delays in flows)
2. **Array stocks** (multi-dimensional stocks for cohort models)
3. **Lookup tables** (non-linear functions via interpolation)
4. **Sensitivity analysis** (parameter sweeps with Result overlays)
5. **Model export** (generate Vensim/Stella compatible files)

---

## 11. ASCII Diagram: Complete Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Spanner Graph Database                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │
│  │ GraphNode  │  │ GraphNode  │  │ GraphNode  │  │ GraphEdge  │   │
│  │ label:     │  │ label:     │  │ label:     │  │ label: flow│   │
│  │  "stock"   │  │ "variable" │  │ "parameter"│  │ from: S1   │   │
│  │ properties:│  │ properties:│  │ properties:│  │ to: S2     │   │
│  │  {current_ │  │  {formula, │  │  {value,   │  │ properties:│   │
│  │   value,   │  │   ...}     │  │   range}   │  │  {formula, │   │
│  │   units}   │  └────────────┘  └────────────┘  │   rate}    │   │
│  └────────────┘                                   └────────────┘   │
└────────────────────────┬────────────────────────────────────────────┘
                         │ GQL: MATCH (s:stock)-[f:flow]->(t:stock)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Effect-Atom State Layer                           │
│                                                                      │
│  Remote Atoms                 Managed ReactFlow                     │
│  ┌──────────────┐            ┌─────────────────┐                   │
│  │ sdStocksAtom │───sync───> │reactFlowNodesA..│                   │
│  │ sdVarsAtom   │            │  (writable)     │                   │
│  │ sdFlowsAtom  │            │  get.subscribe()│                   │
│  └──────────────┘            └─────────────────┘                   │
│                                                                      │
│  Simulation                   Layout                                │
│  ┌──────────────┐            ┌─────────────────┐                   │
│  │ simStateAtom │            │ layoutedGraphA..│                   │
│  │ runSimAtom   │            │ applyLayoutAtom │                   │
│  └──────────────┘            └─────────────────┘                   │
└────────────────────────┬────────────────────────────────────────────┘
                         │ useAtomValue / useAtomSet
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     XYFlow Canvas (ReactFlow)                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ <ReactFlow                                                     │ │
│  │   nodes={nodes}                                                │ │
│  │   edges={edges}                                                │ │
│  │   nodeTypes={{ stock: StockNode, variable: VariableNode }}    │ │
│  │   edgeTypes={{ flow: FlowEdge }}                              │ │
│  │ >                                                              │ │
│  │   ┌──────────┐   ────flow────>   ┌──────────┐                │ │
│  │   │ Stock 1  │  (valve symbol)    │ Stock 2  │                │ │
│  │   │ 1000 ppl │                    │ 500 ppl  │                │ │
│  │   └──────────┘                    └──────────┘                │ │
│  │                                                                │ │
│  │   ╭─────╮                                                      │ │
│  │   │ Var │  ─────link────>  (influences flow)                 │ │
│  │   ╰─────╯                                                      │ │
│  │                                                                │ │
│  │   <Panel> [▶️ Play] [⏸️ Pause] [🔄 Reset] t=5.3s </Panel>     │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Appendix: Stock-Flow Notation Reference

| Symbol | Name | Meaning |
|--------|------|---------|
| ▭ | Stock | Accumulated quantity |
| →⟍→ | Flow | Rate of change (valve on pipe) |
| ○ | Variable | Computed value |
| ◇ | Parameter | User-adjustable constant |
| ☁ | Cloud | Infinite source/sink |
| ⤏ | Link | Information dependency |

---

**End of Research Document**

Generated by Agent C
For: `/Users/ryanhunter/artimath/lever/packages/effect-system-dynamics`
Architecture: Effect.ts + Effect-Atom + XYFlow + Cloud Spanner Graph
