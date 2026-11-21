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
    <main className="studio-view flex min-h-0 flex-1 flex-col" hidden={!active}>
      <StudioToolbar studio={studio} library={library} onOpenList={() => void openList()} />
      {s.following ? (
        <div className="followbar mx-4 mb-2 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-[#5a4a2a] bg-[#241f15] px-3 py-2 text-[14px] text-[#f0d9ad]">
          <span>Following {s.following}&apos;s piano roll (read-only)</span>
          <button type="button" className="ml-auto" onClick={() => studio.follow(null)}>
            Back to my melody
          </button>
        </div>
      ) : null}
      <div
        className="roll relative mx-3 min-h-[110px] flex-1 overflow-auto overscroll-contain rounded-[10px] border border-line bg-[#1b1e23]"
        ref={rollRef}
      />
      <div className="flex-none px-3 pt-2 pb-2.5 short:pt-1 short:pb-1.5" hidden={s.keyboardHidden}>
        <div className="mb-1.5 flex flex-wrap items-center gap-3 short:mb-1">
          <OctaveControls controller={studio.keyboard} compact />
          <span className="text-[13px] text-muted short:hidden very-narrow:hidden">
            Play here (or <b>A W S E D…</b>) to hear notes · press <b className="text-err">●</b> to record
            them into the melody
          </span>
        </div>
        <Keyboard controller={studio.keyboard} sounding={s.sounding} teacher={teacherNotes} compact />
      </div>
      <MelodiesDialog open={listOpen} onClose={() => setListOpen(false)} library={library} currentId={s.id} />
    </main>
  );
}
