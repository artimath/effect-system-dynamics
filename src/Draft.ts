/**
 * Draft Schemas for System Dynamics editor integrations.
 *
 * Captures UI-oriented metadata (layout positions, descriptions, units) alongside
 * the canonical system dynamics model structure so drafts can round-trip between
 * browser editors and the Effect runtime.
 *
 * @since 0.2.0
 */

import { Schema } from "effect"
import { TimeConfig } from "./Model.js"

/**
 * XYPosition - 2D layout coordinates for editor nodes.
 *
 * Stored in persisted drafts to restore canvas layout.
 *
 * @category Drafts
 * @since 0.2.0
 */
export const XYPositionSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
})
export type XYPosition = Schema.Schema.Type<typeof XYPositionSchema>

const OptionalReferenceSchema = Schema.optional(
  Schema.Union(Schema.String, Schema.Literal(null)),
)

/**
 * StockDraft - persisted view-model for stock nodes (includes layout).
 *
 * @category Drafts
 * @since 0.2.0
 */
export const StockDraftSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  initialValue: Schema.Number.pipe(Schema.finite()),
  units: Schema.String,
  description: Schema.optional(Schema.String),
  position: XYPositionSchema,
})
export type StockDraft = Schema.Schema.Type<typeof StockDraftSchema>

/**
 * FlowDraft - persisted view-model for flow nodes (includes layout).
 *
 * @category Drafts
 * @since 0.2.0
 */
export const FlowDraftSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: OptionalReferenceSchema,
  target: OptionalReferenceSchema,
  rateEquation: Schema.String,
  units: Schema.String,
  position: XYPositionSchema,
})
export type FlowDraft = Schema.Schema.Type<typeof FlowDraftSchema>

/**
 * VariableDraft - persisted view-model for auxiliary/constant nodes.
 *
 * @category Drafts
 * @since 0.2.0
 */
export const VariableDraftSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  equation: Schema.String,
  type: Schema.Literal("auxiliary", "constant"),
  value: Schema.optional(Schema.Number),
  position: XYPositionSchema,
})
export type VariableDraft = Schema.Schema.Type<typeof VariableDraftSchema>

/**
 * SystemDynamicsDraft - complete persisted draft representation.
 *
 * @category Drafts
 * @since 0.2.0
 */
export const SystemDynamicsDraftSchema = Schema.Struct({
  modelId: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  time: TimeConfig,
  stocks: Schema.Array(StockDraftSchema),
  flows: Schema.Array(FlowDraftSchema),
  variables: Schema.Array(VariableDraftSchema),
})
export type SystemDynamicsDraft = Schema.Schema.Type<typeof SystemDynamicsDraftSchema>
