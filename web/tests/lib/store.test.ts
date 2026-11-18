import { describe, expect, it, vi } from "vitest";
import { Emitter, Store } from "@/lib/store";

describe("Store", () => {
  it("tells subscribers about changes only", () => {
    const s = new Store({ a: 1, b: 2 });
    const fn = vi.fn();
    const stop = s.subscribe(fn);
    s.patch({ a: 3 });
    expect(s.get()).toEqual({ a: 3, b: 2 });
    s.set(s.get()); // the same value
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    s.set({ a: 0, b: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Emitter", () => {
  it("a failing listener doesn't stop the others", () => {
    const e = new Emitter<number>();
    const good = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    e.on(() => {
      throw new Error("boom");
    });
    e.on(good);
    e.emit(7);
    expect(good).toHaveBeenCalledWith(7);
  });
});
