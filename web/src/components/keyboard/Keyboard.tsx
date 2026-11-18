"use client";

/**
 * An on-screen piano keyboard (mouse, multi-touch, glissando by sliding). What it does is kept in
 * a KeyboardController (lib/keyboard-controller.ts): this component draws its keys and passes
 * pointer events to it. As many white keys as fit its width are shown.
 */
import { useEffect, useRef, type PointerEvent } from "react";
import { useStore } from "@/hooks/useStore";
import { type KeyboardController } from "@/lib/keyboard-controller";
import { keyboardLayout, loadKeyboardLayout } from "@/lib/keyboard-layout";
import { baseMidi, KEY_CODES, keyLabel, layoutKeys, whiteKeysFor } from "@/lib/keys";
import { noteName } from "@/lib/notes";

export interface KeyboardProps {
  controller: KeyboardController;
  /** Notes sounding now (highlighted). */
  sounding?: readonly number[];
  /** Notes the live teacher is playing (marked, for students). */
  teacher?: readonly number[];
}

/** The note of the key under a screen point, if it's one of this keyboard's keys; 0 otherwise. */
function keyAt(keyboard: HTMLElement, x: number, y: number): number {
  const key = document.elementFromPoint(x, y)?.closest<HTMLElement>(".key");
  return key && keyboard.contains(key) ? Number(key.dataset.midi) : 0;
}

export function Keyboard({ controller, sounding = [], teacher = [] }: KeyboardProps) {
  const { octave, whiteCount, down } = useStore(controller.store);
  const layout = useStore(keyboardLayout, null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);

  // Fit the keys to the width (also when it's shown after being hidden)
  useEffect(() => {
    loadKeyboardLayout();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      if (!wrap.clientWidth) return; // hidden
      controller.setWhiteCount(whiteKeysFor(wrap.clientWidth, matchMedia("(pointer: coarse)").matches));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    fit();
    return () => observer.disconnect();
  }, [controller]);

  // Let go of the keys if the keyboard goes away
  useEffect(() => () => controller.releaseAll(), [controller]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    controller.pointerDown(e.pointerId, keyAt(e.currentTarget, e.clientX, e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (controller.isTracking(e.pointerId)) {
      controller.pointerMove(e.pointerId, keyAt(e.currentTarget, e.clientX, e.clientY));
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => controller.pointerUp(e.pointerId);

  const base = baseMidi(octave);
  const label = (midi: number) => {
    const code = KEY_CODES[midi - base];
    return code ? <span className="kbd">{keyLabel(code, layout)}</span> : null;
  };
  const held = new Set(down);
  const playing = new Set(sounding);
  const marked = new Set(teacher);
  const state = (midi: number) =>
    (held.has(midi) ? " down" : "") +
    (playing.has(midi) ? " sounding" : "") +
    (marked.has(midi) ? " teacher" : "");

  return (
    <div className="wrap" ref={wrapRef}>
      <div
        className="keyboard"
        ref={keyboardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {layoutKeys(octave, whiteCount).map((k) =>
          k.black ? (
            <div
              key={k.midi}
              className={`key black${state(k.midi)}`}
              data-midi={k.midi}
              style={{ left: `${k.left}%`, width: `${k.width}%` }}
            >
              {label(k.midi)}
            </div>
          ) : (
            <div
              key={k.midi}
              className={`key white${k.midi % 12 === 0 ? " c" : ""}${state(k.midi)}`}
              data-midi={k.midi}
            >
              {label(k.midi)}
              <b>{noteName(k.midi)}</b>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** The octave buttons and the range shown ("C4–E6"). */
export function OctaveControls({ controller }: { controller: KeyboardController }) {
  const { octave, whiteCount } = useStore(controller.store);
  const whites = layoutKeys(octave, whiteCount).filter((k) => !k.black);
  const first = whites[0]?.midi;
  const last = whites.at(-1)?.midi;
  const range = first && last ? `${noteName(first)}–${noteName(last)}` : `C${octave}`;
  return (
    <div className="octave">
      <button
        type="button"
        aria-label="Octave down"
        disabled={!controller.canShift(-1)}
        onClick={() => controller.shift(-1)}
      >
        −
      </button>
      <span>{range}</span>
      <button
        type="button"
        aria-label="Octave up"
        disabled={!controller.canShift(1)}
        onClick={() => controller.shift(1)}
      >
        +
      </button>
    </div>
  );
}
