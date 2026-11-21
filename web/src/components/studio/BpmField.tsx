"use client";

/**
 * The tempo field. The new tempo applies when the user is done with it (Enter, leaving the field,
 * or a click on the spinner: the browser's change event), not on every keystroke; the field then
 * shows the tempo actually set (20-400).
 */
import { useEffect, useEffectEvent, useRef } from "react";
import { DEFAULT_BPM, MAX_BPM, MIN_BPM } from "@/studio/constants";

export function BpmField({ bpm, onCommit }: { bpm: number; onCommit: (value: number) => number }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useEffectEvent(() => {
    const el = ref.current;
    if (el) el.value = String(onCommit(Number(el.value)));
  });

  useEffect(() => {
    const el = ref.current;
    el?.addEventListener("change", commit);
    return () => el?.removeEventListener("change", commit);
  }, []);

  // Changed elsewhere (undo, opening a melody, the teacher's roll)
  useEffect(() => {
    if (ref.current && Number(ref.current.value) !== bpm) ref.current.value = String(bpm);
  }, [bpm]);

  return (
    <label className="flex items-center gap-1.5 text-[13px] text-muted">
      BPM{" "}
      <input
        ref={ref}
        className="w-[6.5ch]"
        type="number"
        min={MIN_BPM}
        max={MAX_BPM}
        step={1}
        defaultValue={DEFAULT_BPM}
      />
    </label>
  );
}
