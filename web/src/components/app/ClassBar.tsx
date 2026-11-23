"use client";

/** The bar under the header while in class: the live lesson, my turn on the buzzer, the teacher's notes. */
import { useStore } from "@/hooks/useStore";
import { noteNames } from "@/lib/notes";
import { api, classState } from "@/services";
import { isLive, queuePosition } from "@/state/class-state";

export function ClassBar() {
  const cls = useStore(classState.store);
  const me = useStore(api.session, null)?.user.username ?? null;
  const parts: string[] = [];
  if (isLive(cls, me)) parts.push(`You're giving the lesson (${cls.lesson.mode})`);
  else if (cls.lesson.live) parts.push(`${cls.lesson.live} is giving a ${cls.lesson.mode} lesson`);
  const pos = queuePosition(cls, me);
  if (cls.where === "classroom" && me && cls.buzzer.holder === me) parts.push("you're playing on the buzzer");
  else if (cls.where === "classroom" && pos > 0) parts.push(`you're #${pos + 1} for the buzzer`);
  if (cls.status.state !== "on" || !parts.length) return null;
  const live = !!cls.lesson.live;
  return (
    <div
      className={`classbar mx-4 mb-2 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[14px] ${live ? "border-warm-line bg-warm-bg" : "border-line bg-panel"}`}
    >
      <span
        className={`size-2.5 flex-none rounded-full ${live ? "animate-[blink_1.2s_infinite_alternate] bg-teacher shadow-[0_0_8px_var(--color-teacher)]" : "bg-muted"}`}
      />
      <span>{parts.join(" · ")}</span>
      <span className="teacher-notes ml-auto font-semibold text-teacher tabular-nums">
        {noteNames(cls.teacherNotes)}
      </span>
    </div>
  );
}
