import type { UnitMap } from "../Quantity.js"

export interface DelayStateEntry {
  readonly stages: ReadonlyArray<number>
  readonly units: UnitMap
}

export class DelayStateStore {
  readonly #state = new Map<string, DelayStateEntry>()

  get(id: string): DelayStateEntry | undefined {
    return this.#state.get(id)
  }

  set(id: string, entry: DelayStateEntry): void {
    this.#state.set(id, {
      stages: [...entry.stages],
      units: { ...entry.units },
    })
  }

  ensure(id: string, factory: () => DelayStateEntry): DelayStateEntry {
    const existing = this.#state.get(id)
    if (existing) {
      return existing
    }
    const created = factory()
    this.set(id, created)
    return this.#state.get(id)!
  }

  clone(): DelayStateStore {
    const copy = new DelayStateStore()
    for (const [id, entry] of this.#state.entries()) {
      copy.set(id, entry)
    }
    return copy
  }
}
