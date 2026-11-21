"use client";

/**
 * The page: the header, Piano and Studio modes (both stay mounted, so switching keeps what each
 * one was doing), the class, and the dialogs. It wires the computer keyboard to the mode in use
 * and silences everything when the page loses focus.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ClassDialog } from "@/components/class/ClassDialog";
import { AuthDialog } from "@/components/dialogs/AuthDialog";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { UserDialog } from "@/components/dialogs/UserDialog";
import { PianoView, type PianoHandle } from "@/components/piano/PianoView";
import { StudioView } from "@/components/studio/StudioView";
import { Toaster } from "@/components/ui/Toaster";
import { useMode } from "@/hooks/useMode";
import { useSelect, useStore } from "@/hooks/useStore";
import { api, classState, sound } from "@/services";
import { confirmDialog, openAuth } from "@/state/dialogs";
import { toast } from "@/state/toast";
import { StudioEngine } from "@/studio/engine";
import { MelodyLibrary } from "@/studio/library";
import { ClassBar } from "./ClassBar";
import { Header } from "./Header";
import { SecureNotice } from "./SecureNotice";
import { useLessonSync } from "./useLessonSync";

/** Typing in a field (or a dialog being open) isn't playing the piano. */
function typing(e: KeyboardEvent): boolean {
  return (
    !!(e.target as Element | null)?.closest?.("input, select, textarea") ||
    !!document.querySelector("dialog[open]")
  );
}

export function PianoApp() {
  const [studio] = useState(() => new StudioEngine({ sound, toast }));
  const [library] = useState(
    () => new MelodyLibrary(studio, { api, toast, confirm: confirmDialog, openAuth }),
  );
  const piano = useRef<PianoHandle>(null);
  const [mode, setMode] = useMode();
  const shown = mode ?? "piano";
  const [classOpen, setClassOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const user = useStore(api.session, null)?.user ?? null;
  const teacherNotes = useSelect(classState.store, (c) => c.teacherNotes);

  useLessonSync(studio, mode, setMode);

  // Entering a mode: the studio starts listening; leaving one: it lets go of everything
  useEffect(() => {
    if (!mode) return;
    const pianoHandle = piano.current;
    if (mode === "studio") studio.setActive(true);
    return () => {
      if (mode === "piano") pianoHandle?.releaseAll();
      else studio.setActive(false);
      sound.output(0);
    };
  }, [mode, studio]);

  // The computer keyboard plays the mode in use
  const keyDown = useEffectEvent((e: KeyboardEvent) => {
    if (typing(e)) return;
    if (shown === "studio") {
      if (e.code === "Space") (document.activeElement as HTMLElement | null)?.blur?.(); // not a click too
      if (studio.keyDown(e)) sound.unlockAudio();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (piano.current?.keyDown(e)) sound.unlockAudio();
  });
  const keyUp = useEffectEvent((e: KeyboardEvent) => {
    if (shown === "studio") {
      if (e.code === "Space" && !(e.target as Element | null)?.closest?.("input, select, textarea"))
        e.preventDefault();
      studio.keyUp(e);
    } else {
      piano.current?.keyUp(e);
    }
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyDown(e);
    const up = (e: KeyboardEvent) => keyUp(e);
    // Don't leave a note stuck on when the app loses focus
    const releaseEverything = () => {
      piano.current?.releaseAll();
      studio.panic();
    };
    const onVisibility = () => {
      if (document.hidden) releaseEverything();
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", releaseEverything);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", releaseEverything);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [studio]);

  const openAccount = () => {
    if (user) setUserOpen(true);
    else void openAuth();
  };

  return (
    <div className="flex h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <Header
        mode={shown}
        onModeChange={setMode}
        onOpenClass={() => setClassOpen(true)}
        onOpenAccount={openAccount}
      />
      <SecureNotice />
      <ClassBar />
      <PianoView ref={piano} active={shown === "piano"} teacherNotes={teacherNotes} />
      <StudioView studio={studio} library={library} active={shown === "studio"} teacherNotes={teacherNotes} />
      <ClassDialog open={classOpen} onClose={() => setClassOpen(false)} mode={shown} />
      <UserDialog user={user} open={userOpen} onClose={() => setUserOpen(false)} />
      <AuthDialog />
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}
