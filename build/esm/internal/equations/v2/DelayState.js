export class DelayStateStore {
    #state = new Map();
    get(id) {
        return this.#state.get(id);
    }
    set(id, entry) {
        this.#state.set(id, {
            stages: [...entry.stages],
            units: { ...entry.units },
        });
    }
    ensure(id, factory) {
        const existing = this.#state.get(id);
        if (existing) {
            return existing;
        }
        const created = factory();
        this.set(id, created);
        return this.#state.get(id);
    }
    clone() {
        const copy = new DelayStateStore();
        for (const [id, entry] of this.#state.entries()) {
            copy.set(id, entry);
        }
        return copy;
    }
}
//# sourceMappingURL=DelayState.js.map