export type UnitMap = Record<string, number>;
export interface Quantity {
    readonly value: number;
    readonly units: UnitMap;
}
export declare const UNIT_MISMATCH = "UnitMismatch";
export declare const NON_INTEGER_EXPONENT = "NonIntegerExponent";
export declare const makeQuantity: (value: number, units?: UnitMap) => Quantity;
export declare const unitlessQuantity: (value: number) => Quantity;
export declare const isUnitless: (quantity: Quantity) => boolean;
export declare const multiplyQuantities: (left: Quantity, right: Quantity) => Quantity;
export declare const divideQuantities: (left: Quantity, right: Quantity) => Quantity;
export declare const negateQuantity: (quantity: Quantity) => Quantity;
export declare const addQuantities: (left: Quantity, right: Quantity, expression: string) => Quantity;
export declare const subtractQuantities: (left: Quantity, right: Quantity, expression: string) => Quantity;
export declare const powQuantities: (quantity: Quantity, exponent: number, expression: string) => Quantity;
export declare const invertUnits: (units: UnitMap) => UnitMap;
export declare const multiplyUnits: (left: UnitMap, right: UnitMap) => UnitMap;
export declare const divideUnits: (left: UnitMap, right: UnitMap) => UnitMap;
export declare const powUnits: (units: UnitMap, exponent: number) => UnitMap;
export declare const equalUnits: (left: UnitMap, right: UnitMap) => boolean;
//# sourceMappingURL=Quantity.d.ts.map