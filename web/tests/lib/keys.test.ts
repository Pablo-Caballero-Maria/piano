import { describe, expect, it } from "vitest";
import { baseMidi, keyLabel, keyOffset, layoutKeys, whiteKeysFor } from "@/lib/keys";

describe("keyboard layout", () => {
  it("white keys from C, black keys between them", () => {
    const keys = layoutKeys(4, 7); // C4…B4
    expect(keys.filter((k) => !k.black).map((k) => k.midi)).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(keys.filter((k) => k.black).map((k) => k.midi)).toEqual([61, 63, 66, 68, 70]);
    const cSharp = keys.find((k) => k.midi === 61)!;
    expect(cSharp.left).toBeCloseTo(100 / 7);
    expect(cSharp.width).toBeCloseTo(58 / 7);
  });

  it("no black key after the last white one", () => {
    const keys = layoutKeys(4, 1); // just C4
    expect(keys).toEqual([{ midi: 60, black: false }]);
  });

  it("how many keys fit", () => {
    expect(whiteKeysFor(300, false)).toBe(7); // at least an octave
    expect(whiteKeysFor(52 * 10, false)).toBe(10);
    expect(whiteKeysFor(44 * 10, true)).toBe(10);
    expect(whiteKeysFor(5000, false)).toBe(22);
  });

  it("computer keys", () => {
    expect(baseMidi(4)).toBe(60);
    expect(keyOffset("KeyA")).toBe(0);
    expect(keyOffset("KeyW")).toBe(1);
    expect(keyOffset("Quote")).toBe(17);
    expect(keyOffset("KeyZ")).toBe(-1);
    expect(keyLabel("KeyA")).toBe("A");
    expect(keyLabel("Semicolon")).toBe(";");
    expect(keyLabel("KeyA", new Map([["KeyA", "q"]]))).toBe("Q"); // AZERTY
  });
});
