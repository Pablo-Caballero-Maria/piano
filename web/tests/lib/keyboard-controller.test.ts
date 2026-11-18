// The on-screen keyboard's logic: pointers, glissando, computer keys, octaves.
import { describe, expect, it } from "vitest";
import { KeyboardController } from "@/lib/keyboard-controller";

function setup(octave = 4) {
  const events: string[] = [];
  const kb = new KeyboardController(
    { onDown: (m) => events.push(`+${m}`), onUp: (m) => events.push(`-${m}`) },
    octave,
  );
  return { kb, events };
}

const key = (code: string, repeat = false) => ({ code, repeat, preventDefault() {} });

describe("KeyboardController", () => {
  it("a finger sliding over the keys plays each one (glissando)", () => {
    const { kb, events } = setup();
    kb.pointerDown(1, 60);
    expect(kb.state.down).toEqual([60]);
    kb.pointerMove(1, 62);
    kb.pointerMove(1, 62); // same key: nothing
    kb.pointerMove(1, 0); // between keys
    kb.pointerUp(1);
    expect(events).toEqual(["+60", "-60", "+62", "-62"]);
    expect(kb.state.down).toEqual([]);
  });

  it("several fingers at once", () => {
    const { kb, events } = setup();
    kb.pointerDown(1, 60);
    kb.pointerDown(2, 64);
    expect(kb.state.down).toEqual([60, 64]);
    kb.pointerUp(1);
    expect(kb.state.down).toEqual([64]);
    expect(events).toEqual(["+60", "+64", "-60"]);
  });

  it("computer keys play from the octave's C; Z / X change octave", () => {
    const { kb, events } = setup();
    expect(kb.keyDown(key("KeyA"))).toBe(true);
    expect(kb.keyDown(key("KeyA", true))).toBe(true); // auto-repeat: ignored
    kb.keyUp({ code: "KeyA" });
    expect(kb.keyDown(key("KeyX"))).toBe(true);
    kb.keyDown(key("KeyW"));
    expect(kb.keyDown(key("KeyQ"))).toBe(false); // not a piano key
    expect(events).toEqual(["+60", "-60", "+73"]);
    expect(kb.state.octave).toBe(5);
  });

  it("changing octave or size lets go of every key", () => {
    const { kb, events } = setup();
    kb.pointerDown(1, 60);
    kb.keyDown(key("KeyS"));
    kb.shift(-1);
    expect(events).toEqual(["+60", "+62", "-60", "-62"]);
    kb.pointerDown(2, 50);
    kb.setWhiteCount(10);
    expect(events.at(-1)).toBe("-50");
  });

  it("octaves stay between 1 and 6", () => {
    const { kb } = setup(6);
    expect(kb.canShift(1)).toBe(false);
    kb.shift(1);
    expect(kb.state.octave).toBe(6);
    kb.shift(-9);
    expect(kb.state.octave).toBe(1);
    expect(kb.canShift(-1)).toBe(false);
  });
});
