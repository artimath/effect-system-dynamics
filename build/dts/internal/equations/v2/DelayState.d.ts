import type { UnitMap } from "../Quantity.js";
export interface DelayStateEntry {
    readonly stages: ReadonlyArray<number>;
    readonly units: UnitMap;
}
export declare class DelayStateStore {
    #private;
    get(id: string): DelayStateEntry | undefined;
    set(id: string, entry: DelayStateEntry): void;
    ensure(id: string, factory: () => DelayStateEntry): DelayStateEntry;
    clone(): DelayStateStore;
}
//# sourceMappingURL=DelayState.d.ts.map