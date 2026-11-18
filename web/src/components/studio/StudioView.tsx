"use client";

/**
 * Studio mode: the toolbar, the piano roll (drawn by the StudioEngine into its element), and the
 * keyboard under it. While following the teacher's roll, a bar says so and offers the way back.
 */
import { useEffect, useRef, useState } from "react";
import { Keyboard, OctaveControls } from "@/components/keyboard/Keyboard";
import { useStore } from "@/hooks/useStore";
import type { StudioEngine } from "@/studio/engine";
import type { MelodyLibrary } from "@/studio/library";
import { MelodiesDialog } from "./MelodiesDialog";
import { StudioToolbar } from "./StudioToolbar";

export interface StudioViewProps {
  studio: StudioEngine;
  library: MelodyLibrary;
  active: boolean;
  /** What the live teacher is playing (marked on the keys). */
  teacherNotes: readonly number[];
}

export function StudioView({ studio, library, active, teacherNotes }: StudioViewProps) {
  const s = useStore(studio.store);
  const rollRef = useRef<HTMLDivElement>(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    if (!rollRef.current) return;
    studio.attach(rollRef.current);
    return () => studio.detach();
  }, [studio]);

  useEffect(() => studio.saveShortcut.on(() => void library.save()), [studio, library]);

  const openList = async () => {
    if (await library.ensureLoggedIn()) setListOpen(true);
  };

  return (
    <main className="view studio-view" hidden={!active}>
      <StudioToolbar studio={studio} library={library} onOpenList={() => void openList()} />
      {s.following ? (
        <div className="followbar">
          <span>Following {s.following}&apos;s piano roll (read-only)</span>
          <button type="button" onClick={() => studio.follow(null)}>
            Back to my melody
          </button>
        </div>
      ) : null}
      <div className="roll" ref={rollRef} />
      <div className="studio-keys" hidden={s.keyboardHidden}>
        <div className="kb-bar">
          <OctaveControls controller={studio.keyboard} />
          <span className="hint inline">
            Play here (or <b>A W S E D…</b>) to hear notes · press <b className="rec-dot">●</b> to record them
            into the melody
          </span>
        </div>
        <Keyboard controller={studio.keyboard} sounding={s.sounding} teacher={teacherNotes} />
      </div>
      <MelodiesDialog open={listOpen} onClose={() => setListOpen(false)} library={library} currentId={s.id} />
    </main>
  );
}
