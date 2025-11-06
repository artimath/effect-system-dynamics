import { describe, it, expect } from "vitest"
import { Schema, Equal } from "effect"
import { Stock, Flow, Variable, TimeConfig, Model } from "../src/Model.js"
import { StockId, FlowId, VariableId, ModelId } from "../src/Types.js"

describe("Core Domain Schemas", () => {
  describe("Stock", () => {
    const validStockId = "550e8400-e29b-41d4-a716-446655440000"

    it("decodes valid stock with all fields", () => {
      const stockData = {
        id: validStockId,
        name: "Population",
        initialValue: 1000,
        units: "people",
        description: "Total population in the region",
      }

      const result = Schema.decodeUnknownSync(Stock)(stockData)

      expect(result.name).toBe("Population")
      expect(result.initialValue).toBe(1000)
      expect(result.units).toBe("people")
      expect(result.description).toBe("Total population in the region")
    })

    it("decodes valid stock with minimal fields", () => {
      const stockData = {
        id: validStockId,
        name: "Inventory",
        initialValue: 500,
      }

      const result = Schema.decodeUnknownSync(Stock)(stockData)

      expect(result.name).toBe("Inventory")
      expect(result.initialValue).toBe(500)
      expect(result.units).toBeUndefined()
      expect(result.description).toBeUndefined()
    })

    it("fails on empty name", () => {
      const stockData = {
        id: validStockId,
        name: "",
        initialValue: 100,
      }

      expect(() => Schema.decodeUnknownSync(Stock)(stockData)).toThrow()
    })

    it("fails on whitespace-only name", () => {
      const stockData = {
        id: validStockId,
        name: "   ",
        initialValue: 100,
      }

      expect(() => Schema.decodeUnknownSync(Stock)(stockData)).toThrow()
    })

    it("fails on NaN initialValue", () => {
      const stockData = {
        id: validStockId,
        name: "Test Stock",
        initialValue: NaN,
      }

      expect(() => Schema.decodeUnknownSync(Stock)(stockData)).toThrow()
    })

    it("constructor creates valid stock", () => {
      const stock = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Cash Balance",
        initialValue: 10000,
        units: "USD",
      })

      expect(stock.name).toBe("Cash Balance")
      expect(stock.initialValue).toBe(10000)
    })

    it("two stocks with same values are Equal", () => {
      const stock1 = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Population",
        initialValue: 1000,
      })

      const stock2 = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Population",
        initialValue: 1000,
      })

      expect(Equal.equals(stock1, stock2)).toBe(true)
    })

    it("two stocks with different values are not Equal", () => {
      const stock1 = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Population",
        initialValue: 1000,
      })

      const stock2 = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Population",
        initialValue: 2000,
      })

      expect(Equal.equals(stock1, stock2)).toBe(false)
    })
  })

  describe("Flow", () => {
    const validFlowId = "660e8400-e29b-41d4-a716-446655440001"
    const validStockId = "550e8400-e29b-41d4-a716-446655440000"

    it("decodes valid flow with all fields", () => {
      const flowData = {
        id: validFlowId,
        name: "Births",
        source: undefined, // cloud source
        target: validStockId,
        rateEquation: "0.01 * [Population]",
        units: "people/year",
      }

      const result = Schema.decodeUnknownSync(Flow)(flowData)

      expect(result.name).toBe("Births")
      expect(result.source).toBeUndefined()
      expect(result.target).toBe(validStockId)
      expect(result.rateEquation).toBe("0.01 * [Population]")
      expect(result.units).toBe("people/year")
    })

    it("decodes flow with source and target", () => {
      const sourceId = "770e8400-e29b-41d4-a716-446655440002"
      const flowData = {
        id: validFlowId,
        name: "Migration",
        source: sourceId,
        target: validStockId,
        rateEquation: "0.005 * [Source Region]",
      }

      const result = Schema.decodeUnknownSync(Flow)(flowData)

      expect(result.source).toBe(sourceId)
      expect(result.target).toBe(validStockId)
    })

    it("decodes cloud source and cloud sink flow", () => {
      const flowData = {
        id: validFlowId,
        name: "Net Effect",
        rateEquation: "constant",
      }

      const result = Schema.decodeUnknownSync(Flow)(flowData)

      expect(result.source).toBeUndefined()
      expect(result.target).toBeUndefined()
    })

    it("fails on empty name", () => {
      const flowData = {
        id: validFlowId,
        name: "",
        rateEquation: "1.0",
      }

      expect(() => Schema.decodeUnknownSync(Flow)(flowData)).toThrow()
    })

    it("constructor creates valid flow", () => {
      const flow = new Flow({
        id: Schema.decodeSync(FlowId)(validFlowId),
        name: "Sales",
        target: Schema.decodeSync(StockId)(validStockId),
        rateEquation: "demand * price",
        units: "USD/month",
      })

      expect(flow.name).toBe("Sales")
      expect(flow.rateEquation).toBe("demand * price")
    })
  })

  describe("Variable", () => {
    const validVariableId = "770e8400-e29b-41d4-a716-446655440002"

    it("decodes auxiliary variable", () => {
      const variableData = {
        id: validVariableId,
        name: "Growth Rate",
        equation: "0.01 * (1 - [Population] / [Carrying Capacity])",
        type: "auxiliary" as const,
      }

      const result = Schema.decodeUnknownSync(Variable)(variableData)

      expect(result.name).toBe("Growth Rate")
      expect(result.type).toBe("auxiliary")
      expect(result.equation).toBe("0.01 * (1 - [Population] / [Carrying Capacity])")
      expect(result.value).toBeUndefined()
    })

    it("decodes constant with value", () => {
      const variableData = {
        id: validVariableId,
        name: "Carrying Capacity",
        equation: "",
        type: "constant" as const,
        value: 10000,
      }

      const result = Schema.decodeUnknownSync(Variable)(variableData)

      expect(result.name).toBe("Carrying Capacity")
      expect(result.type).toBe("constant")
      expect(result.value).toBe(10000)
    })

    it("fails on empty name", () => {
      const variableData = {
        id: validVariableId,
        name: "",
        equation: "1.0",
        type: "constant" as const,
      }

      expect(() => Schema.decodeUnknownSync(Variable)(variableData)).toThrow()
    })

    it("fails on invalid type", () => {
      const variableData = {
        id: validVariableId,
        name: "Test",
        equation: "1.0",
        type: "invalid",
      }

      expect(() => Schema.decodeUnknownSync(Variable)(variableData)).toThrow()
    })

    it("constructor creates valid auxiliary variable", () => {
      const variable = new Variable({
        id: Schema.decodeSync(VariableId)(validVariableId),
        name: "Birth Rate",
        equation: "0.02",
        type: "auxiliary",
      })

      expect(variable.name).toBe("Birth Rate")
      expect(variable.type).toBe("auxiliary")
    })

    it("constructor creates valid constant", () => {
      const variable = new Variable({
        id: Schema.decodeSync(VariableId)(validVariableId),
        name: "Max Capacity",
        equation: "",
        type: "constant",
        value: 5000,
      })

      expect(variable.name).toBe("Max Capacity")
      expect(variable.type).toBe("constant")
      expect(variable.value).toBe(5000)
    })
  })

  describe("TimeConfig", () => {
    it("decodes valid time config", () => {
      const timeConfigData = {
        start: 0,
        end: 100,
        step: 0.25,
      }

      const result = Schema.decodeUnknownSync(TimeConfig)(timeConfigData)

      expect(result.start).toBe(0)
      expect(result.end).toBe(100)
      expect(result.step).toBe(0.25)
    })

    it("fails when step is zero", () => {
      const timeConfigData = {
        start: 0,
        end: 100,
        step: 0,
      }

      expect(() => Schema.decodeUnknownSync(TimeConfig)(timeConfigData)).toThrow()
    })

    it("fails when step is negative", () => {
      const timeConfigData = {
        start: 0,
        end: 100,
        step: -1,
      }

      expect(() => Schema.decodeUnknownSync(TimeConfig)(timeConfigData)).toThrow()
    })

    it("allows end to equal start", () => {
      const timeConfigData = {
        start: 50,
        end: 50,
        step: 1,
      }

      // end > 0 but doesn't need to be > start
      const result = Schema.decodeUnknownSync(TimeConfig)(timeConfigData)
      expect(result.start).toBe(50)
      expect(result.end).toBe(50)
    })

    it("constructor creates valid time config", () => {
      const timeConfig = new TimeConfig({
        start: 0,
        end: 100,
        step: 1,
      })

      expect(timeConfig.start).toBe(0)
      expect(timeConfig.end).toBe(100)
      expect(timeConfig.step).toBe(1)
    })
  })

  describe("Model", () => {
    const validModelId = "880e8400-e29b-41d4-a716-446655440000"
    const validStockId = "550e8400-e29b-41d4-a716-446655440000"
    const validFlowId = "660e8400-e29b-41d4-a716-446655440001"
    const validVariableId = "770e8400-e29b-41d4-a716-446655440002"

    it("decodes valid model with all entities", () => {
      const stock = {
        id: validStockId,
        name: "Population",
        initialValue: 1000,
      }

      const flow = {
        id: validFlowId,
        name: "Births",
        target: validStockId,
        rateEquation: "0.01 * [Population]",
      }

      const variable = {
        id: validVariableId,
        name: "Growth Rate",
        equation: "0.01",
        type: "constant" as const,
        value: 0.01,
      }

      const modelData = {
        id: validModelId,
        name: "Population Model",
        stocks: [stock],
        flows: [flow],
        variables: [variable],
        timeConfig: {
          start: 0,
          end: 100,
          step: 1,
        },
      }

      const result = Schema.decodeUnknownSync(Model)(modelData)

      expect(result.name).toBe("Population Model")
      expect(result.stocks).toHaveLength(1)
      expect(result.flows).toHaveLength(1)
      expect(result.variables).toHaveLength(1)
      expect(result.timeConfig.end).toBe(100)
    })

    it("decodes model with empty arrays", () => {
      const modelData = {
        id: validModelId,
        name: "Empty Model",
        stocks: [],
        flows: [],
        variables: [],
        timeConfig: {
          start: 0,
          end: 10,
          step: 0.1,
        },
      }

      const result = Schema.decodeUnknownSync(Model)(modelData)

      expect(result.stocks).toHaveLength(0)
      expect(result.flows).toHaveLength(0)
      expect(result.variables).toHaveLength(0)
    })

    it("fails on empty model name", () => {
      const modelData = {
        id: validModelId,
        name: "",
        stocks: [],
        flows: [],
        variables: [],
        timeConfig: {
          start: 0,
          end: 10,
          step: 1,
        },
      }

      expect(() => Schema.decodeUnknownSync(Model)(modelData)).toThrow()
    })

    it("constructor creates valid model", () => {
      const stock = new Stock({
        id: Schema.decodeSync(StockId)(validStockId),
        name: "Inventory",
        initialValue: 500,
      })

      const timeConfig = new TimeConfig({
        start: 0,
        end: 365,
        step: 1,
      })

      const model = new Model({
        id: Schema.decodeSync(ModelId)(validModelId),
        name: "Inventory Model",
        stocks: [stock],
        flows: [],
        variables: [],
        timeConfig,
      })

      expect(model.name).toBe("Inventory Model")
      expect(model.stocks).toHaveLength(1)
      expect(model.timeConfig.end).toBe(365)
    })
  })
})
