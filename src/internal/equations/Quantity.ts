export type UnitMap = Record<string, number>

export interface Quantity {
  readonly value: number
  readonly units: UnitMap
}

const EPSILON = 1e-12
export const UNIT_MISMATCH = "UnitMismatch"
export const NON_INTEGER_EXPONENT = "NonIntegerExponent"

const normalizeUnits = (units: UnitMap): UnitMap => {
  const result: UnitMap = Object.create(null)
  for (const key of Object.keys(units)) {
    const exponent = units[key] ?? 0
    if (Math.abs(exponent) > EPSILON) {
      result[key] = exponent
    }
  }
  return result
}

export const makeQuantity = (value: number, units?: UnitMap): Quantity => ({
  value,
  units: normalizeUnits(units ? { ...units } : Object.create(null)),
})

export const unitlessQuantity = (value: number): Quantity => makeQuantity(value)

export const isUnitless = (quantity: Quantity): boolean =>
  Object.keys(quantity.units).length === 0

const cloneUnits = (source: UnitMap): UnitMap => ({ ...source })

const combineUnits = (left: UnitMap, right: UnitMap, multiplier: 1 | -1): UnitMap => {
  const result: UnitMap = cloneUnits(left)
  for (const key of Object.keys(right)) {
    result[key] = (result[key] ?? 0) + (right[key] ?? 0) * multiplier
  }
  return normalizeUnits(result)
}

export const multiplyQuantities = (left: Quantity, right: Quantity): Quantity =>
  makeQuantity(left.value * right.value, combineUnits(left.units, right.units, 1))

export const divideQuantities = (left: Quantity, right: Quantity): Quantity =>
  makeQuantity(left.value / right.value, combineUnits(left.units, right.units, -1))

export const negateQuantity = (quantity: Quantity): Quantity =>
  makeQuantity(-quantity.value, quantity.units)

const assertSameUnits = (left: Quantity, right: Quantity): void => {
  const leftKeys = Object.keys(left.units)
  const rightKeys = Object.keys(right.units)
  if (leftKeys.length !== rightKeys.length) {
    throw new Error(UNIT_MISMATCH)
  }
  for (const key of leftKeys) {
    if (Math.abs((left.units[key] ?? 0) - (right.units[key] ?? 0)) > EPSILON) {
      throw new Error(UNIT_MISMATCH)
    }
  }
}

export const addQuantities = (
  left: Quantity,
  right: Quantity,
  expression: string,
): Quantity => {
  assertSameUnits(left, right)
  return makeQuantity(left.value + right.value, left.units)
}

export const subtractQuantities = (
  left: Quantity,
  right: Quantity,
  expression: string,
): Quantity => {
  assertSameUnits(left, right)
  return makeQuantity(left.value - right.value, left.units)
}

export const powQuantities = (
  quantity: Quantity,
  exponent: number,
  expression: string,
): Quantity => {
  if (!Number.isFinite(exponent)) {
    throw new Error(expression)
  }
  if (!isUnitless(quantity) && Math.abs(exponent - Math.round(exponent)) > EPSILON) {
    throw new Error(NON_INTEGER_EXPONENT)
  }
  const units: UnitMap = Object.create(null)
  for (const key of Object.keys(quantity.units)) {
    units[key] = (quantity.units[key] ?? 0) * exponent
  }
  return makeQuantity(Math.pow(quantity.value, exponent), units)
}

export const invertUnits = (units: UnitMap): UnitMap => {
  const result: UnitMap = Object.create(null)
  for (const key of Object.keys(units)) {
    result[key] = -(units[key] ?? 0)
  }
  return normalizeUnits(result)
}

export const multiplyUnits = (left: UnitMap, right: UnitMap): UnitMap =>
  combineUnits(left, right, 1)

export const divideUnits = (left: UnitMap, right: UnitMap): UnitMap =>
  combineUnits(left, right, -1)

export const powUnits = (units: UnitMap, exponent: number): UnitMap => {
  const result: UnitMap = Object.create(null)
  for (const key of Object.keys(units)) {
    result[key] = (units[key] ?? 0) * exponent
  }
  return normalizeUnits(result)
}

export const equalUnits = (left: UnitMap, right: UnitMap): boolean => {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Math.abs((left[key] ?? 0) - (right[key] ?? 0)) <= EPSILON,
    )
  )
}
