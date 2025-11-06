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

import { Context, Data, Effect, Layer, Ref, Schema } from "effect"
import { Quantity, UnitMap, makeQuantity } from "./internal/equations/Quantity.js"

/**
 * Canonical representation of the dimension for a unit: keys are dimension names,
 * values are exponents (e.g. `{ mass: 1 }`, `{ length: 1, time: -2 }`).
 *
 * @since 0.1.0
 */
export type DimensionMap = Readonly<Record<string, number>>

const DimensionMapSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Number,
})

const normalizeSymbol = (symbol: string): string => symbol.trim().toLowerCase()

/**
 * Declarative unit definition describing how a symbol relates to a canonical
 * dimension and base scaling factor.
 *
 * @since 0.1.0
 */
export class UnitDefinition extends Schema.Class<UnitDefinition>("UnitDefinition")({
  symbol: Schema.NonEmptyTrimmedString,
  dimension: DimensionMapSchema,
  factor: Schema.Number.pipe(Schema.greaterThan(0)),
  description: Schema.optional(Schema.String),
}) {}

/**
 * Aggregate registry holding all known unit definitions.
 *
 * @since 0.1.0
 */
export class UnitRegistry extends Schema.Class<UnitRegistry>("UnitRegistry")({
  units: Schema.Array(UnitDefinition),
}) {
  /**
   * Convert the registry into a lookup map keyed by unit symbol.
   */
  toMap(): ReadonlyMap<string, UnitDefinition> {
    return new Map(
      this.units.map((definition) => [normalizeSymbol(definition.symbol), definition] as const),
    )
  }
}

/**
 * Raised when a requested unit symbol does not exist within the registry.
 *
 * @since 0.1.0
 */
export class UnitNotFoundError extends Data.TaggedError("UnitNotFoundError")<{
  readonly symbol: string
}> {
  override get message(): string {
    return `Unknown unit symbol "${this.symbol}"`
  }
}

/**
 * Raised when two unit definitions are incompatible (mismatched dimensions).
 *
 * @since 0.1.0
 */
export class UnitDimensionMismatchError extends Data.TaggedError("UnitDimensionMismatchError")<{
  readonly from: string
  readonly to: string
  readonly fromDimension: DimensionMap
  readonly toDimension: DimensionMap
}> {
  override get message(): string {
    return `Cannot convert ${this.from} to ${this.to}: dimensions do not match`
  }
}

/**
 * Raised when attempting to convert a composite quantity that is not currently
 * supported by the helper routines (e.g., multi-symbol or non-unit exponents).
 *
 * @since 0.1.0
 */
export class UnsupportedQuantityError extends Data.TaggedError("UnsupportedQuantityError")<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

const dimensionKey = (dimension: DimensionMap): string =>
  Object.entries(dimension)
    .filter(([, exponent]) => Math.abs(exponent) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, exponent]) => `${name}:${exponent}`)
    .join("|")

const lookupUnit = (
  registry: UnitRegistry,
  symbol: string,
): Effect.Effect<UnitDefinition, UnitNotFoundError> => {
  const definition = registry.toMap().get(normalizeSymbol(symbol))
  return definition
    ? Effect.succeed(definition)
    : Effect.fail(new UnitNotFoundError({ symbol }))
}

const ensureSameDimension = (
  from: UnitDefinition,
  to: UnitDefinition,
): Effect.Effect<void, UnitDimensionMismatchError> =>
  dimensionKey(from.dimension) === dimensionKey(to.dimension)
    ? Effect.void
    : Effect.fail(
        new UnitDimensionMismatchError({
          from: from.symbol,
          to: to.symbol,
          fromDimension: from.dimension,
          toDimension: to.dimension,
        }),
      )

/**
 * Register a set of unit definitions into a registry.
 *
 * @category Constructors
 * @since 0.1.0
 */
export const makeRegistry = (
  definitions: ReadonlyArray<UnitDefinition>,
): UnitRegistry => new UnitRegistry({ units: [...definitions] })

/**
 * Append additional unit definitions to an existing registry.
 *
 * @category Constructors
 * @since 0.1.0
 */
export const extendRegistry = (
  registry: UnitRegistry,
  definitions: ReadonlyArray<UnitDefinition>,
): UnitRegistry =>
  new UnitRegistry({ units: [...registry.units, ...definitions] })

/**
 * Explicitly convert a scalar value from one unit to another within the same
 * dimension. Returns the converted numeric value inside an effect.
 *
 * @category Conversions
 * @since 0.1.0
 */
export const convertValue = (
  registry: UnitRegistry,
  value: number,
  fromSymbol: string,
  toSymbol: string,
): Effect.Effect<number, UnitNotFoundError | UnitDimensionMismatchError> =>
  Effect.gen(function* () {
    const from = yield* lookupUnit(registry, fromSymbol)
    const to = yield* lookupUnit(registry, toSymbol)
    yield* ensureSameDimension(from, to)
    return (value * from.factor) / to.factor
  })

const assertSimpleQuantity = (
  quantity: Quantity,
): Effect.Effect<[symbol: string, exponent: number], UnsupportedQuantityError> => {
  const entries = Object.entries(quantity.units)
  if (entries.length !== 1) {
    return Effect.fail(
      new UnsupportedQuantityError({ reason: "Only single-symbol quantities can be converted" }),
    )
  }
  const firstEntry = entries[0]
  if (!firstEntry) {
    return Effect.fail(
      new UnsupportedQuantityError({ reason: "Only single-symbol quantities can be converted" }),
    )
  }
  const [symbol, exponent] = firstEntry
  if (Math.abs(exponent - 1) > 1e-12) {
    return Effect.fail(
      new UnsupportedQuantityError({ reason: "Only exponent 1 quantities can be converted" }),
    )
  }
  return Effect.succeed([symbol, exponent])
}

/**
 * Convert a quantity whose unit map contains a single symbol with exponent 1 to
 * a target unit symbol. The resulting quantity shares the same canonical
 * dimension.
 *
 * @category Conversions
 * @since 0.1.0
 */
export const convertQuantity = (
  registry: UnitRegistry,
  quantity: Quantity,
  toSymbol: string,
): Effect.Effect<Quantity, UnitNotFoundError | UnitDimensionMismatchError | UnsupportedQuantityError> =>
  Effect.gen(function* () {
    const [fromSymbol] = yield* assertSimpleQuantity(quantity)
    const convertedValue = yield* convertValue(registry, quantity.value, fromSymbol, toSymbol)
    yield* lookupUnit(registry, toSymbol)
    return makeQuantity(convertedValue, { [normalizeSymbol(toSymbol)]: 1 })
  })

/**
 * Helper that constructs a quantity for a value expressed in the provided unit
 * symbol.
 *
 * @category Constructors
 * @since 0.1.0
 */
export const quantityFromUnit = (
  registry: UnitRegistry,
  value: number,
  symbol: string,
): Effect.Effect<Quantity, UnitNotFoundError> =>
  Effect.map(lookupUnit(registry, symbol), () => makeQuantity(value, { [normalizeSymbol(symbol)]: 1 }))

export interface UnitManagerService {
  readonly register: (definitions: ReadonlyArray<UnitDefinition>) => Effect.Effect<UnitRegistry, never>
  readonly registry: Effect.Effect<UnitRegistry>
  readonly find: (symbol: string) => Effect.Effect<UnitDefinition, UnitNotFoundError>
  readonly ensureUnitMap: (units: UnitMap) => Effect.Effect<void, UnitNotFoundError>
  readonly convertValue: (
    value: number,
    fromSymbol: string,
    toSymbol: string,
  ) => Effect.Effect<number, UnitNotFoundError | UnitDimensionMismatchError>
  readonly convertQuantity: (
    quantity: Quantity,
    toSymbol: string,
  ) => Effect.Effect<Quantity, UnitNotFoundError | UnitDimensionMismatchError | UnsupportedQuantityError>
}

const DEFAULT_UNIT_DEFINITIONS: ReadonlyArray<UnitDefinition> = [
  new UnitDefinition({ symbol: "tick", dimension: { time: 1 }, factor: 1, description: "Simulation tick" }),
  new UnitDefinition({ symbol: "month", dimension: { time: 1 }, factor: 30, description: "Calendar month" }),
  new UnitDefinition({ symbol: "year", dimension: { time: 1 }, factor: 365, description: "Calendar year" }),
  new UnitDefinition({ symbol: "people", dimension: { population: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "widgets", dimension: { inventory: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "inventory", dimension: { inventory: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "kg", dimension: { mass: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "liters", dimension: { volume: 1 }, factor: 1 }),
  new UnitDefinition({ symbol: "usd", dimension: { currency: 1 }, factor: 1 }),
]

const ensureUnitExists = (
  registry: UnitRegistry,
  symbol: string,
): Effect.Effect<UnitDefinition, UnitNotFoundError> => lookupUnit(registry, symbol)

const ensureUnitMapKnown = (
  registry: UnitRegistry,
  units: UnitMap,
): Effect.Effect<void, UnitNotFoundError> =>
  Effect.all(Object.keys(units).map((symbol) => ensureUnitExists(registry, symbol)), {
    discard: true,
  })

export class UnitManager extends Context.Tag("@org/effect-system-dynamics/UnitManager")<
  UnitManager,
  UnitManagerService
>() {
  static layer(initialDefinitions: ReadonlyArray<UnitDefinition> = DEFAULT_UNIT_DEFINITIONS) {
    return Layer.effect(this, Effect.gen(function* () {
      const registryRef = yield* Ref.make(makeRegistry(initialDefinitions))
      const getRegistry = Ref.get(registryRef)

      const service: UnitManagerService = {
        register: (definitions) =>
          Ref.updateAndGet(registryRef, (current) => extendRegistry(current, definitions)),
        registry: getRegistry,
        find: (symbol) => Effect.flatMap(getRegistry, (registry) => ensureUnitExists(registry, symbol)),
        ensureUnitMap: (units) => Effect.flatMap(getRegistry, (registry) => ensureUnitMapKnown(registry, units)),
        convertValue: (value, fromSymbol, toSymbol) =>
          Effect.flatMap(getRegistry, (registry) => convertValue(registry, value, fromSymbol, toSymbol)),
        convertQuantity: (quantity, toSymbol) =>
          Effect.flatMap(getRegistry, (registry) => convertQuantity(registry, quantity, toSymbol)),
      }

      return service
    }))
  }
}
