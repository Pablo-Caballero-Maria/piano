/**
 * A tiny observable value, the bridge between the page's logic (plain TypeScript) and React:
 * components read it with useStore() (hooks/useStore.ts), which is built on
 * React's useSyncExternalStore. The value is replaced, never mutated, so React sees each change.
 */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  /** Replace the value (or derive it from the current one) and tell every subscriber. */
  set = (next: T | ((current: T) => T)): void => {
    const value = typeof next === "function" ? (next as (current: T) => T)(this.value) : next;
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const fn of [...this.listeners]) fn();
  };

  /** Merge fields into an object value. */
  patch = (fields: Partial<T>): void => this.set((v) => ({ ...v, ...fields }));

  /** Call fn after every change; returns the function that stops it. */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
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
