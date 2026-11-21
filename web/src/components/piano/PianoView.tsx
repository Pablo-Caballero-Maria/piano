"use client";

/**
 * Piano mode: play live. The buzzer can only play one note at a time, so the most recently pressed
 * held note sounds; releasing it falls back to the previous one still held.
 */
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Keyboard, OctaveControls } from "@/components/keyboard/Keyboard";
import { useKeyboard } from "@/components/keyboard/useKeyboard";
import { freqOf } from "@/lib/notes";
import { sound } from "@/services";
import { NowPlaying } from "./NowPlaying";

/** What the page does with the piano from outside: computer keys, and letting go of everything. */
export interface PianoHandle {
  keyDown(e: KeyboardEvent): boolean;
  keyUp(e: KeyboardEvent): void;
  releaseAll(): void;
}

export interface PianoViewProps {
  /** Piano is the mode in use (only then does it sound). */
  active: boolean;
  /** What the live teacher is playing (marked on the keys). */
  teacherNotes: readonly number[];
  ref?: Ref<PianoHandle>;
}

export function PianoView({ active, teacherNotes, ref }: PianoViewProps) {
  const held = useRef<number[]>([]); // MIDI notes in press order (duplicates allowed)
  const [note, setNote] = useState(0);

  const update = () => {
    const m = held.current.at(-1) ?? 0;
    setNote(m);
    if (active) sound.output(m ? freqOf(m) : 0, m ? [m] : []);
  };

  const keyboard = useKeyboard({
    onDown: (m) => {
      sound.unlockAudio();
      held.current.push(m);
      update();
    },
    onUp: (m) => {
      const i = held.current.lastIndexOf(m);
      if (i >= 0) held.current.splice(i, 1);
      update();
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      keyDown: (e) => keyboard.keyDown(e),
      keyUp: (e) => keyboard.keyUp(e),
      releaseAll: () => keyboard.releaseAll(),
    }),
    [keyboard],
  );

  // Back in piano mode: sound what's held (usually nothing)
  const activated = useEffectEvent(update);
  useEffect(() => {
    if (active) activated();
  }, [active]);

  return (
    <main className="piano-view flex min-h-0 flex-1 flex-col" hidden={!active}>
      <div className="flex flex-wrap items-center gap-2.5 px-4 pb-3 short:pb-2">
        <NowPlaying pitches={note ? [note] : []} freq={note ? freqOf(note) : 0} />
        <OctaveControls controller={keyboard} />
      </div>
      <div className="px-4 pb-2.5 text-[13px] text-muted short:hidden no-mouse:hidden">
        Keyboard: <b>A W S E D F T G Y H U J K…</b> play notes · <b>Z / X</b> change octave · the speaker
        button also plays them on this device
      </div>
      <div className="px-4 pb-2.5 text-[13px] text-muted short:hidden landscape-or-mouse:hidden">
        Tip: turn your phone sideways for more keys.
      </div>
      <Keyboard controller={keyboard} sounding={note ? [note] : []} teacher={teacherNotes} />
    </main>
  );
}
