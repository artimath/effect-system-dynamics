/**
 * Draft Schemas for System Dynamics editor integrations.
 *
 * Captures UI-oriented metadata (layout positions, descriptions, units) alongside
 * the canonical system dynamics model structure so drafts can round-trip between
 * browser editors and the Effect runtime.
 *
 * @since 0.2.0
 */
import { Schema } from "effect";
import { TimeConfig } from "./Model.js";
/**
 * XYPosition - 2D layout coordinates for editor nodes.
 *
 * Stored in persisted drafts to restore canvas layout.
 *
 * @category Drafts
 * @since 0.2.0
 */
export declare const XYPositionSchema: Schema.Struct<{
    x: typeof Schema.Number;
    y: typeof Schema.Number;
}>;
export type XYPosition = Schema.Schema.Type<typeof XYPositionSchema>;
/**
 * StockDraft - persisted view-model for stock nodes (includes layout).
 *
 * @category Drafts
 * @since 0.2.0
 */
export declare const StockDraftSchema: Schema.Struct<{
    id: typeof Schema.String;
    name: typeof Schema.String;
    initialValue: Schema.filter<typeof Schema.Number>;
    units: typeof Schema.String;
    description: Schema.optional<typeof Schema.String>;
    position: Schema.Struct<{
        x: typeof Schema.Number;
        y: typeof Schema.Number;
    }>;
}>;
export type StockDraft = Schema.Schema.Type<typeof StockDraftSchema>;
/**
 * FlowDraft - persisted view-model for flow nodes (includes layout).
 *
 * @category Drafts
 * @since 0.2.0
 */
export declare const FlowDraftSchema: Schema.Struct<{
    id: typeof Schema.String;
    name: typeof Schema.String;
    source: Schema.optional<Schema.Union<[typeof Schema.String, Schema.Literal<[null]>]>>;
    target: Schema.optional<Schema.Union<[typeof Schema.String, Schema.Literal<[null]>]>>;
    rateEquation: typeof Schema.String;
    units: typeof Schema.String;
    position: Schema.Struct<{
        x: typeof Schema.Number;
        y: typeof Schema.Number;
    }>;
}>;
export type FlowDraft = Schema.Schema.Type<typeof FlowDraftSchema>;
/**
 * VariableDraft - persisted view-model for auxiliary/constant nodes.
 *
 * @category Drafts
 * @since 0.2.0
 */
export declare const VariableDraftSchema: Schema.Struct<{
    id: typeof Schema.String;
    name: typeof Schema.String;
    equation: typeof Schema.String;
    type: Schema.Literal<["auxiliary", "constant"]>;
    value: Schema.optional<typeof Schema.Number>;
    position: Schema.Struct<{
        x: typeof Schema.Number;
        y: typeof Schema.Number;
    }>;
}>;
export type VariableDraft = Schema.Schema.Type<typeof VariableDraftSchema>;
/**
 * SystemDynamicsDraft - complete persisted draft representation.
 *
 * @category Drafts
 * @since 0.2.0
 */
export declare const SystemDynamicsDraftSchema: Schema.Struct<{
    modelId: typeof Schema.String;
    name: typeof Schema.String;
    description: Schema.optional<typeof Schema.String>;
    time: typeof TimeConfig;
    stocks: Schema.Array$<Schema.Struct<{
        id: typeof Schema.String;
        name: typeof Schema.String;
        initialValue: Schema.filter<typeof Schema.Number>;
        units: typeof Schema.String;
        description: Schema.optional<typeof Schema.String>;
        position: Schema.Struct<{
            x: typeof Schema.Number;
            y: typeof Schema.Number;
        }>;
    }>>;
    flows: Schema.Array$<Schema.Struct<{
        id: typeof Schema.String;
        name: typeof Schema.String;
        source: Schema.optional<Schema.Union<[typeof Schema.String, Schema.Literal<[null]>]>>;
        target: Schema.optional<Schema.Union<[typeof Schema.String, Schema.Literal<[null]>]>>;
        rateEquation: typeof Schema.String;
        units: typeof Schema.String;
        position: Schema.Struct<{
            x: typeof Schema.Number;
            y: typeof Schema.Number;
        }>;
    }>>;
    variables: Schema.Array$<Schema.Struct<{
        id: typeof Schema.String;
        name: typeof Schema.String;
        equation: typeof Schema.String;
        type: Schema.Literal<["auxiliary", "constant"]>;
        value: Schema.optional<typeof Schema.Number>;
        position: Schema.Struct<{
            x: typeof Schema.Number;
            y: typeof Schema.Number;
        }>;
    }>>;
}>;
export type SystemDynamicsDraft = Schema.Schema.Type<typeof SystemDynamicsDraftSchema>;
//# sourceMappingURL=Draft.d.ts.map