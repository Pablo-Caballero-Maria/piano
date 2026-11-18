// The class as the page sees it, from the link's messages.
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/services/api";
import { ClassLink } from "@/services/link";
import type { ServerMessage } from "@/services/link/messages";
import type { Emit } from "@/services/link/transport";
import { ClassState, isLive, isWatching, queuePosition } from "@/state/class-state";

async function setup(me = "ana", role: "teacher" | "student" = "student") {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ mode: "classroom", realtime: "ws" }))) as unknown as typeof fetch;
  const api = new ApiClient(fetchFn, { token: "tok", user: { username: me, role } });
  let emit: Emit = () => {};
  const sent: unknown[] = [];
  const link = new ClassLink(api, {
    classroom: (_t, e) => {
      emit = e;
      return {
        open: true,
        close() {},
        note() {},
        activity() {},
        live: (on, mode) => sent.push(["live", on, mode]),
        studio() {},
        queue: (action, args) => sent.push([action, args]),
      };
    },
  });
  const toast = vi.fn();
  const cls = new ClassState(api, link, toast);
  await link.start();
  return { cls, send: (m: ServerMessage) => emit(m), sent, toast };
}

const BUZZER = { holder: null, live: null, granted: null, queue: [] };

describe("ClassState", () => {
  it("the welcome brings the lesson, the buzzer, the board and the teacher's roll", async () => {
    const { cls, send } = await setup();
    const roll = vi.fn();
    cls.teacherRoll.on(roll);
    send({ t: "status", state: "on", text: "In class" });
    const studio = { melody: { name: "x", bpm: 90, notes: "" }, playhead: 0, playing: false };
    send({
      t: "welcome",
      lesson: { live: "Profe", mode: "studio" },
      buzzer: BUZZER,
      board: { online: true },
      people: [],
      studio,
    });
    const s = cls.store.get();
    expect(s.where).toBe("classroom");
    expect(s.lesson).toEqual({ live: "Profe", mode: "studio" });
    expect(s.board).toEqual({ online: true });
    expect(roll).toHaveBeenCalledWith(studio);
    expect(cls.watchingLesson()).toBe(true);
  });

  it("a lesson starting is announced; ending it clears the teacher's notes and roll", async () => {
    const { cls, send, toast } = await setup();
    const roll = vi.fn();
    cls.teacherRoll.on(roll);
    send({ t: "lesson", live: "Profe", mode: "piano" });
    expect(toast).toHaveBeenCalledWith("Profe started the lesson");
    send({ t: "teacher.note", freq: 262, midi: [60] });
    expect(cls.store.get().teacherNotes).toEqual([60]);
    send({ t: "lesson", live: null, mode: "piano" });
    expect(cls.store.get().teacherNotes).toEqual([]);
    expect(roll).toHaveBeenLastCalledWith(null);
  });

  it("my turn on the buzzer is announced (not to the live teacher)", async () => {
    const { cls, send, toast } = await setup();
    send({ t: "buzzer", holder: "ana", live: null, granted: null, queue: ["ana", "bo"] });
    expect(toast).toHaveBeenCalledWith("Your turn: you're playing on the buzzer");
    expect(cls.queuePosition()).toBe(0);
    cls.toggleBuzzerRequest(); // in the queue: leave it
    const teacher = await setup("Profe", "teacher");
    teacher.send({ t: "buzzer", holder: "Profe", live: "Profe", granted: null, queue: [] });
    expect(teacher.toast).not.toHaveBeenCalled();
  });

  it("actions go through the link", async () => {
    const { cls, sent } = await setup("Profe", "teacher");
    cls.toggleLive("studio");
    cls.queue("grant", { user: "ana" });
    cls.toggleBuzzerRequest();
    expect(sent).toEqual([
      ["live", true, "studio"],
      ["grant", { user: "ana" }],
      ["join", {}],
    ]);
  });

  it("server errors become toasts", async () => {
    const { send, toast } = await setup();
    send({ t: "error", message: "Only teachers can do that" });
    expect(toast).toHaveBeenCalledWith("Only teachers can do that", "error");
  });

  it("selectors", () => {
    const s = {
      lesson: { live: "Profe", mode: "piano" as const },
      buzzer: { ...BUZZER, queue: ["bo", "ana"] },
    };
    expect(isLive(s as never, "Profe")).toBe(true);
    expect(isWatching(s as never, "ana")).toBe(true);
    expect(queuePosition(s as never, "ana")).toBe(1);
    expect(queuePosition(s as never, null)).toBe(-1);
  });
});
