import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import { StockId, FlowId, VariableId, ModelId } from "../src/Types.js"

describe("Branded ID Types", () => {
  describe("StockId", () => {
    it("decodes valid UUID", () => {
      const validUUID = "550e8400-e29b-41d4-a716-446655440000"
      const result = Schema.decodeUnknownSync(StockId)(validUUID)
      expect(result).toBe(validUUID)
    })

    it("fails to decode invalid string", () => {
      const invalidString = "not-a-uuid"
      expect(() => Schema.decodeUnknownSync(StockId)(invalidString)).toThrow()
    })
  })

  describe("FlowId", () => {
    it("decodes valid UUID", () => {
      const validUUID = "660e8400-e29b-41d4-a716-446655440001"
      const result = Schema.decodeUnknownSync(FlowId)(validUUID)
      expect(result).toBe(validUUID)
    })

    it("fails to decode invalid string", () => {
      const invalidString = "not-a-uuid"
      expect(() => Schema.decodeUnknownSync(FlowId)(invalidString)).toThrow()
    })
  })

  describe("VariableId", () => {
    it("decodes valid UUID", () => {
      const validUUID = "770e8400-e29b-41d4-a716-446655440002"
      const result = Schema.decodeUnknownSync(VariableId)(validUUID)
      expect(result).toBe(validUUID)
    })

    it("fails to decode invalid string", () => {
      const invalidString = "not-a-uuid"
      expect(() => Schema.decodeUnknownSync(VariableId)(invalidString)).toThrow()
    })
  })

  describe("ModelId", () => {
    it("decodes valid UUID", () => {
      const validUUID = "880e8400-e29b-41d4-a716-446655440003"
      const result = Schema.decodeUnknownSync(ModelId)(validUUID)
      expect(result).toBe(validUUID)
    })

    it("fails to decode invalid string", () => {
      const invalidString = "not-a-uuid"
      expect(() => Schema.decodeUnknownSync(ModelId)(invalidString)).toThrow()
    })
  })

  // Type safety tests (compile-time only)
  // These would fail at compile time if uncommented:
  // const stockId: StockId = Schema.decodeSync(StockId)("550e8400-e29b-41d4-a716-446655440000")
  // const flowId: FlowId = stockId  // ❌ Type error: StockId not assignable to FlowId
})
