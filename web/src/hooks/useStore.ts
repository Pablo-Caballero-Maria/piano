import { useSyncExternalStore } from "react";
import type { Store } from "@/lib/store";

/**
 * The current value of a store, re-rendering when it changes. `serverValue` is what the page
 * shows before it runs in the browser (the static HTML), e.g. "logged out" for the session: the
 * browser's own value (from localStorage) takes over right after.
 */
export function useStore<T>(store: Store<T>, serverValue?: T): T {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    serverValue === undefined ? store.get : () => serverValue,
  );
}

/**
 * One part of a store's value, re-rendering only when that part changes. `select` must return the
 * same thing (===) while that part is unchanged, e.g. a field of the value.
 */
export function useSelect<T, U>(store: Store<T>, select: (value: T) => U): U {
  const get = () => select(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}
