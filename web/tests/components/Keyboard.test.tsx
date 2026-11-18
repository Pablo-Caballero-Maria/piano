// The on-screen keyboard component.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Keyboard, OctaveControls } from "@/components/keyboard/Keyboard";
import { KeyboardController } from "@/lib/keyboard-controller";

function setup() {
  const onDown = vi.fn();
  const onUp = vi.fn();
  const kb = new KeyboardController({ onDown, onUp }, 4);
  const view = render(
    <>
      <OctaveControls controller={kb} />
      <Keyboard controller={kb} sounding={[62]} teacher={[64]} />
    </>,
  );
  act(() => kb.setWhiteCount(7)); // what fitting the width does
  return { kb, onDown, onUp, view };
}

describe("Keyboard", () => {
  it("draws white and black keys from C4, marking what sounds and the teacher's notes", () => {
    const { view } = setup();
    expect(view.container.querySelectorAll(".key.white")).toHaveLength(7);
    expect(view.container.querySelectorAll(".key.black")).toHaveLength(5);
    expect(view.container.querySelector('[data-midi="62"]')).toHaveClass("sounding");
    expect(view.container.querySelector('[data-midi="64"]')).toHaveClass("teacher");
    expect(screen.getByText("C4–B4")).toBeInTheDocument();
  });

  it("a press on a key plays it until it's released", () => {
    const { view, onDown, onUp } = setup();
    const keyboard = view.container.querySelector(".keyboard")!;
    const c4 = view.container.querySelector('[data-midi="60"]')!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(c4);
    fireEvent.pointerDown(keyboard, { pointerId: 1 });
    expect(onDown).toHaveBeenCalledWith(60);
    expect(c4).toHaveClass("down");
    fireEvent.pointerUp(keyboard, { pointerId: 1 });
    expect(onUp).toHaveBeenCalledWith(60);
    expect(c4).not.toHaveClass("down");
  });

  it("the octave buttons move it", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Octave up"));
    expect(screen.getByText("C5–B5")).toBeInTheDocument();
  });
});
