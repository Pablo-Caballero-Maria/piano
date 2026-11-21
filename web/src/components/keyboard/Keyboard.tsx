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
  /** The studio's smaller keyboard, under the piano roll. */
  compact?: boolean;
}

/** The note of the key under a screen point, if it's one of this keyboard's keys; 0 otherwise. */
function keyAt(keyboard: HTMLElement, x: number, y: number): number {
  const key = document.elementFromPoint(x, y)?.closest<HTMLElement>(".key");
  return key && keyboard.contains(key) ? Number(key.dataset.midi) : 0;
}

export function Keyboard({ controller, sounding = [], teacher = [], compact = false }: KeyboardProps) {
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
    return code ? (
      <span className="hidden font-mono text-[11px] opacity-80 mouse:block">{keyLabel(code, layout)}</span>
    ) : null;
  };
  const held = new Set(down);
  const playing = new Set(sounding);
  const marked = new Set(teacher);
  // The state as class names (what tests and the pointer code look for) and how each key looks
  const state = (midi: number) =>
    (held.has(midi) ? " down" : "") +
    (playing.has(midi) ? " sounding" : "") +
    (marked.has(midi) ? " teacher" : "");
  const whiteLook = (midi: number) => {
    const bg = playing.has(midi)
      ? "bg-[linear-gradient(#bfe8d2,#8fd4b0)]"
      : held.has(midi)
        ? "bg-[linear-gradient(#e3f3ea,#c9e8d7)]"
        : "bg-[linear-gradient(#fdfcf9,#ecebe6)]";
    const shadow = marked.has(midi)
      ? "shadow-[inset_0_-10px_0_var(--color-teacher)]"
      : held.has(midi)
        ? "shadow-[inset_0_-2px_0_#a9d3bc]"
        : "shadow-[inset_0_-6px_0_#d3d1ca]";
    return `${bg} ${shadow}`;
  };
  const blackLook = (midi: number) => {
    const bg = playing.has(midi)
      ? "bg-[linear-gradient(#3fa673,#2a7b54)]"
      : held.has(midi)
        ? "bg-[linear-gradient(#2f6b50,#1c4835)]"
        : "bg-[linear-gradient(#2c2d33,#0d0e10)]";
    const shadow = marked.has(midi)
      ? "shadow-[inset_0_-8px_0_var(--color-teacher)]"
      : held.has(midi)
        ? "shadow-[inset_0_-2px_0_#000]"
        : "shadow-[inset_0_-5px_0_#000,0_3px_4px_rgba(0,0,0,0.5)]";
    return `${bg} ${shadow}`;
  };

  return (
    <div
      className={
        compact
          ? "flex h-[clamp(84px,22vh,170px)] min-h-0 flex-none items-end short:h-[clamp(70px,24vh,120px)]"
          : "flex min-h-0 flex-1 items-end px-4 pb-4 short:pb-2.5"
      }
      ref={wrapRef}
    >
      <div
        className={`keyboard relative flex size-full touch-none ${compact ? "" : "max-h-[420px]"}`}
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
              className={`key black${state(k.midi)} absolute top-0 z-2 flex h-[60%] -translate-x-1/2 items-end justify-center rounded-b-md pb-2 text-[11px] text-[#8f949c] ${blackLook(k.midi)}`}
              data-midi={k.midi}
              style={{ left: `${k.left}%`, width: `${k.width}%` }}
            >
              {label(k.midi)}
            </div>
          ) : (
            <div
              key={k.midi}
              className={`key white${state(k.midi)} relative mx-px flex flex-1 flex-col items-center justify-end gap-1 rounded-b-lg text-[#8a8a8a] ${compact ? "pb-1.5 text-[11px]" : "pb-3 text-[12px]"} ${whiteLook(k.midi)}`}
              data-midi={k.midi}
            >
              {label(k.midi)}
              <b className={k.midi % 12 === 0 ? "text-[#333]" : undefined}>{noteName(k.midi)}</b>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** The octave buttons and the range shown ("C4–E6"); compact: the studio's, under the piano roll. */
export function OctaveControls({
  controller,
  compact = false,
}: {
  controller: KeyboardController;
  compact?: boolean;
}) {
  const { octave, whiteCount } = useStore(controller.store);
  const whites = layoutKeys(octave, whiteCount).filter((k) => !k.black);
  const first = whites[0]?.midi;
  const last = whites.at(-1)?.midi;
  const range = first && last ? `${noteName(first)}–${noteName(last)}` : `C${octave}`;
  const button = `w-10 px-0 py-2 ${compact ? "short:py-1" : ""}`;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={button}
        aria-label="Octave down"
        disabled={!controller.canShift(-1)}
        onClick={() => controller.shift(-1)}
      >
        −
      </button>
      <span className="min-w-[8ch] text-center text-[14px] text-muted">{range}</span>
      <button
        type="button"
        className={button}
        aria-label="Octave up"
        disabled={!controller.canShift(1)}
        onClick={() => controller.shift(1)}
      >
        +
      </button>
    </div>
  );
}
