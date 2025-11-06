/**
 * Type Foundations & Branded IDs
 *
 * All domain entity IDs are branded UUIDs for compile-time type safety.
 * This prevents accidentally using a StockId where a FlowId is expected.
 *
 * @since 0.1.0
 */
import { Schema } from "effect";
/**
 * Branded UUID for Stock entities
 *
 * @since 0.1.0
 * @category IDs
 */
export declare const StockId: Schema.brand<typeof Schema.UUID, "StockId">;
/**
 * Type extracted from StockId schema
 *
 * @since 0.1.0
 * @category IDs
 */
export type StockId = typeof StockId.Type;
/**
 * Branded UUID for Flow entities
 *
 * @since 0.1.0
 * @category IDs
 */
export declare const FlowId: Schema.brand<typeof Schema.UUID, "FlowId">;
/**
 * Type extracted from FlowId schema
 *
 * @since 0.1.0
 * @category IDs
 */
export type FlowId = typeof FlowId.Type;
/**
 * Branded UUID for Variable entities
 *
 * @since 0.1.0
 * @category IDs
 */
export declare const VariableId: Schema.brand<typeof Schema.UUID, "VariableId">;
/**
 * Type extracted from VariableId schema
 *
 * @since 0.1.0
 * @category IDs
 */
export type VariableId = typeof VariableId.Type;
/**
 * Branded UUID for Model entities
 *
 * @since 0.1.0
 * @category IDs
 */
export declare const ModelId: Schema.brand<typeof Schema.UUID, "ModelId">;
/**
 * Type extracted from ModelId schema
 *
 * @since 0.1.0
 * @category IDs
 */
export type ModelId = typeof ModelId.Type;
/**
 * Branded UUID for Scenario entities
 *
 * @since 0.1.0
 * @category IDs
 */
export declare const ScenarioId: Schema.brand<typeof Schema.UUID, "ScenarioId">;
/**
 * Type extracted from ScenarioId schema
 *
 * @since 0.1.0
 * @category IDs
 */
export type ScenarioId = typeof ScenarioId.Type;
//# sourceMappingURL=Types.d.ts.map