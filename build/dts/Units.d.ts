/**
 * Units module providing schema-backed definitions and explicit conversion helpers.
 *
 * The registry keeps track of symbolic unit definitions, their canonical dimensions,
 * and scaling factors relative to a chosen base unit for that dimension. Conversions
 * are *never* applied automatically by the solver—callers opt-in explicitly via
 * the helper utilities exported here.
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import { Quantity, UnitMap } from "./internal/equations/Quantity.js";
/**
 * Canonical representation of the dimension for a unit: keys are dimension names,
 * values are exponents (e.g. `{ mass: 1 }`, `{ length: 1, time: -2 }`).
 *
 * @since 0.1.0
 */
export type DimensionMap = Readonly<Record<string, number>>;
declare const UnitDefinition_base: Schema.Class<UnitDefinition, {
    symbol: typeof Schema.NonEmptyTrimmedString;
    dimension: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    factor: Schema.filter<typeof Schema.Number>;
    description: Schema.optional<typeof Schema.String>;
}, Schema.Struct.Encoded<{
    symbol: typeof Schema.NonEmptyTrimmedString;
    dimension: Schema.Record$<typeof Schema.String, typeof Schema.Number>;
    factor: Schema.filter<typeof Schema.Number>;
    description: Schema.optional<typeof Schema.String>;
}>, never, {
    readonly symbol: string;
} & {
    readonly description?: string | undefined;
} & {
    readonly dimension: {
        readonly [x: string]: number;
    };
} & {
    readonly factor: number;
}, {}, {}>;
/**
 * Declarative unit definition describing how a symbol relates to a canonical
 * dimension and base scaling factor.
 *
 * @since 0.1.0
 */
export declare class UnitDefinition extends UnitDefinition_base {
}
declare const UnitRegistry_base: Schema.Class<UnitRegistry, {
    units: Schema.Array$<typeof UnitDefinition>;
}, Schema.Struct.Encoded<{
    units: Schema.Array$<typeof UnitDefinition>;
}>, never, {
    readonly units: readonly UnitDefinition[];
}, {}, {}>;
/**
 * Aggregate registry holding all known unit definitions.
 *
 * @since 0.1.0
 */
export declare class UnitRegistry extends UnitRegistry_base {
    /**
     * Convert the registry into a lookup map keyed by unit symbol.
     */
    toMap(): ReadonlyMap<string, UnitDefinition>;
}
declare const UnitNotFoundError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "UnitNotFoundError";
} & Readonly<A>;
/**
 * Raised when a requested unit symbol does not exist within the registry.
 *
 * @since 0.1.0
 */
export declare class UnitNotFoundError extends UnitNotFoundError_base<{
    readonly symbol: string;
}> {
    get message(): string;
}
declare const UnitDimensionMismatchError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "UnitDimensionMismatchError";
} & Readonly<A>;
/**
 * Raised when two unit definitions are incompatible (mismatched dimensions).
 *
 * @since 0.1.0
 */
export declare class UnitDimensionMismatchError extends UnitDimensionMismatchError_base<{
    readonly from: string;
    readonly to: string;
    readonly fromDimension: DimensionMap;
    readonly toDimension: DimensionMap;
}> {
    get message(): string;
}
declare const UnsupportedQuantityError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").Equals<A, {}> extends true ? void : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }) => import("effect/Cause").YieldableError & {
    readonly _tag: "UnsupportedQuantityError";
} & Readonly<A>;
/**
 * Raised when attempting to convert a composite quantity that is not currently
 * supported by the helper routines (e.g., multi-symbol or non-unit exponents).
 *
 * @since 0.1.0
 */
export declare class UnsupportedQuantityError extends UnsupportedQuantityError_base<{
    readonly reason: string;
}> {
    get message(): string;
}
/**
 * Register a set of unit definitions into a registry.
 *
 * @category Constructors
 * @since 0.1.0
 */
export declare const makeRegistry: (definitions: ReadonlyArray<UnitDefinition>) => UnitRegistry;
/**
 * Append additional unit definitions to an existing registry.
 *
 * @category Constructors
 * @since 0.1.0
 */
export declare const extendRegistry: (registry: UnitRegistry, definitions: ReadonlyArray<UnitDefinition>) => UnitRegistry;
/**
 * Explicitly convert a scalar value from one unit to another within the same
 * dimension. Returns the converted numeric value inside an effect.
 *
 * @category Conversions
 * @since 0.1.0
 */
export declare const convertValue: (registry: UnitRegistry, value: number, fromSymbol: string, toSymbol: string) => Effect.Effect<number, UnitNotFoundError | UnitDimensionMismatchError>;
/**
 * Convert a quantity whose unit map contains a single symbol with exponent 1 to
 * a target unit symbol. The resulting quantity shares the same canonical
 * dimension.
 *
 * @category Conversions
 * @since 0.1.0
 */
export declare const convertQuantity: (registry: UnitRegistry, quantity: Quantity, toSymbol: string) => Effect.Effect<Quantity, UnitNotFoundError | UnitDimensionMismatchError | UnsupportedQuantityError>;
/**
 * Helper that constructs a quantity for a value expressed in the provided unit
 * symbol.
 *
 * @category Constructors
 * @since 0.1.0
 */
export declare const quantityFromUnit: (registry: UnitRegistry, value: number, symbol: string) => Effect.Effect<Quantity, UnitNotFoundError>;
export interface UnitManagerService {
    readonly register: (definitions: ReadonlyArray<UnitDefinition>) => Effect.Effect<UnitRegistry, never>;
    readonly registry: Effect.Effect<UnitRegistry>;
    readonly find: (symbol: string) => Effect.Effect<UnitDefinition, UnitNotFoundError>;
    readonly ensureUnitMap: (units: UnitMap) => Effect.Effect<void, UnitNotFoundError>;
    readonly convertValue: (value: number, fromSymbol: string, toSymbol: string) => Effect.Effect<number, UnitNotFoundError | UnitDimensionMismatchError>;
    readonly convertQuantity: (quantity: Quantity, toSymbol: string) => Effect.Effect<Quantity, UnitNotFoundError | UnitDimensionMismatchError | UnsupportedQuantityError>;
}
declare const UnitManager_base: Context.TagClass<UnitManager, "@org/effect-system-dynamics/UnitManager", UnitManagerService>;
export declare class UnitManager extends UnitManager_base {
    static layer(initialDefinitions?: ReadonlyArray<UnitDefinition>): Layer.Layer<UnitManager, never, never>;
}
export {};
//# sourceMappingURL=Units.d.ts.map