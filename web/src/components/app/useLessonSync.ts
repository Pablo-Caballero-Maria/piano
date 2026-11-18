"use client";

/**
 * What the page tells the class, and how it follows the lesson:
 * - my mode and what I'm doing (the teacher's list), at most every 300 ms;
 * - a live teacher in a studio lesson shares the piano roll (playback at once, edits batched);
 * - students follow the teacher's roll, and switch to the lesson's mode when it starts.
 */
import { useEffect, useEffectEvent, useRef } from "react";
import { useSelect, useStore } from "@/hooks/useStore";
import { api, classState, link } from "@/services";
import type { Mode } from "@/services/link/messages";
import type { StudioEngine } from "@/studio/engine";
import type { StudioChange } from "@/studio/types";

const ACTIVITY_EVERY_MS = 300;
const EDITS_EVERY_MS = 250;

export function useLessonSync(studio: StudioEngine, mode: Mode | null, setMode: (m: Mode) => void): void {
  const activityTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useSelect(classState.store, (c) => c.lesson.live);
  const lessonMode = useSelect(classState.store, (c) => c.lesson.mode);
  const token = useStore(api.session, null)?.token ?? null;

  const reportActivity = useEffectEvent(() => {
    if (!mode) return;
    clearTimeout(activityTimer.current);
    activityTimer.current = setTimeout(
      () => link.activity({ mode, detail: mode === "studio" ? studio.studioDetail() : "" }),
      ACTIVITY_EVERY_MS,
    );
  });

  const shareRoll = useEffectEvent((kind: StudioChange) => {
    if (!classState.amLive() || classState.store.get().lesson.mode !== "studio") return;
    clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(
      () => link.studio(studio.studioState()),
      kind === "edit" ? EDITS_EVERY_MS : 0,
    );
  });

  // Join the class (again) whenever someone logs in or out
  useEffect(() => {
    void link.start();
    return () => link.stop();
  }, [token]);

  // A new connection: tell it my mode right away
  const welcomed = useEffectEvent(() => {
    if (mode) link.activity({ mode });
  });
  useEffect(() => link.on("welcome", () => welcomed()), []);

  useEffect(() => {
    reportActivity();
  }, [mode]);

  useEffect(
    () =>
      studio.changes.on((kind) => {
        shareRoll(kind);
        reportActivity();
      }),
    [studio],
  );

  // The live teacher's piano roll (not mine when I'm the one giving the lesson)
  useEffect(
    () =>
      classState.teacherRoll.on((roll) => {
        if (classState.amLive()) return;
        studio.follow(roll ? { ...roll, teacher: classState.store.get().lesson.live } : null);
      }),
    [studio],
  );

  // A lesson started or changed mode: students see its mode; the teacher shares the roll at once
  const lessonChanged = useEffectEvent(() => {
    const { lesson } = classState.store.get();
    if (classState.watchingLesson() && mode && lesson.mode !== mode) setMode(lesson.mode);
    if (classState.amLive()) shareRoll("transport");
  });
  useEffect(() => {
    if (live) lessonChanged();
  }, [live, lessonMode]);

  useEffect(
    () => () => {
      clearTimeout(activityTimer.current);
      clearTimeout(rollTimer.current);
    },
    [],
  );
}
