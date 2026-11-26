/**
 * An observable value, the bridge between the page's logic (plain TypeScript) and React: a zustand
 * store underneath, read by components with useStore()/useSelect() (hooks/useStore.ts). The value
 * is replaced, never mutated, so React sees each change.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

export class Store<T> {
  /** The zustand store that holds the value. */
  readonly api: StoreApi<{ value: T }>;

  constructor(value: T) {
    this.api = createStore<{ value: T }>()(() => ({ value }));
  }

  get = (): T => this.api.getState().value;

  /** Replace the value (or derive it from the current one) and tell every subscriber. */
  set = (next: T | ((current: T) => T)): void => {
    const current = this.get();
    const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
    if (Object.is(value, current)) return;
    this.api.setState({ value });
  };

  /** Merge fields into an object value. */
  patch = (fields: Partial<T>): void => this.set((v) => ({ ...v, ...fields }));

  /** Call fn after every change; returns the function that stops it. */
  subscribe = (fn: () => void): (() => void) => this.api.subscribe(() => fn());
}

/** A set of callbacks: emit(value) calls each one; a failing one doesn't stop the others. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on = (fn: (value: T) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  emit = (value: T): void => {
    for (const fn of [...this.listeners]) {
      try {
        fn(value);
      } catch (e) {
        console.error(e);
      }
    }
  };
}
