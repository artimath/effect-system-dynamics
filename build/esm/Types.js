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
export const StockId = Schema.UUID.pipe(Schema.brand("StockId"));
/**
 * Branded UUID for Flow entities
 *
 * @since 0.1.0
 * @category IDs
 */
export const FlowId = Schema.UUID.pipe(Schema.brand("FlowId"));
/**
 * Branded UUID for Variable entities
 *
 * @since 0.1.0
 * @category IDs
 */
export const VariableId = Schema.UUID.pipe(Schema.brand("VariableId"));
/**
 * Branded UUID for Model entities
 *
 * @since 0.1.0
 * @category IDs
 */
export const ModelId = Schema.UUID.pipe(Schema.brand("ModelId"));
/**
 * Branded UUID for Scenario entities
 *
 * @since 0.1.0
 * @category IDs
 */
export const ScenarioId = Schema.UUID.pipe(Schema.brand("ScenarioId"));
//# sourceMappingURL=Types.js.map