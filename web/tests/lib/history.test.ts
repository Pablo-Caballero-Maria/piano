import { describe, expect, it } from "vitest";
import { UndoHistory } from "@/lib/history";

describe("UndoHistory", () => {
  it("undoes and redoes", () => {
    const h = new UndoHistory<string>();
    expect(h.canUndo).toBe(false);
    h.push("a"); // a → b
    h.push("b"); // b → c
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeUndefined();
    expect(h.redo("a")).toBe("b");
    expect(h.canUndo && h.canRedo).toBe(true);
  });

  it("a new change forgets what could be redone", () => {
    const h = new UndoHistory<string>();
    h.push("a");
    h.undo("b");
    h.push("a2");
    expect(h.canRedo).toBe(false);
  });

  it("keeps at most `max` states", () => {
    const h = new UndoHistory<number>(2);
    [1, 2, 3].forEach((n) => h.push(n));
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });
});
