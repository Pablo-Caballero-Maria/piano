// The classroom's WebSocket to the teacher's PC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassroomTransport, classroomUrl } from "@/services/link/classroom";
import type { ServerMessage } from "@/services/link/messages";
import { FakeSocket } from "./fakes";

function setup() {
  const sockets: FakeSocket[] = [];
  const got: ServerMessage[] = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  const t = new ClassroomTransport({
    token: "tok",
    emit: (m) => got.push(m),
    url: "wss://pc/ws",
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  return {
    t,
    sockets,
    got,
    statuses: () => got.filter((m) => m.t === "status").map((m) => (m as { text: string }).text),
  };
}

describe("ClassroomTransport", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("the address follows the page's", () => {
    expect(classroomUrl({ protocol: "https:", host: "pc.duckdns.org" })).toBe("wss://pc.duckdns.org/ws");
    expect(classroomUrl({ protocol: "http:", host: "localhost:8080" })).toBe("ws://localhost:8080/ws");
  });

  it("says hello with the token, and is in class after the welcome", () => {
    const { t, sockets, got, statuses } = setup();
    const ws = sockets[0]!;
    ws.open();
    expect(ws.sent).toEqual([{ t: "hello", token: "tok", mode: "piano" }]);
    t.note(440, [69]); // not in class yet: dropped
    ws.receive({ t: "welcome", lesson: { live: null, mode: "piano" }, buzzer: {}, board: null });
    expect(t.open).toBe(true);
    expect(statuses()).toEqual(["Joining the class…", "In class"]);
    t.note(440, [69]);
    t.activity({ mode: "studio", detail: "editing" });
    t.queue("move", { user: "bo", to: 0 });
    expect(ws.sent.slice(1)).toEqual([
      { t: "note", freq: 440, midi: [69] },
      { t: "activity", mode: "studio", detail: "editing" },
      { t: "queue.move", user: "bo", to: 0 },
    ]);
    expect(got.some((m) => m.t === "welcome")).toBe(true);
  });

  it("reconnects with a growing wait, saying hello in the mode I was in", () => {
    const { t, sockets } = setup();
    sockets[0]!.open();
    sockets[0]!.receive({ t: "welcome" });
    t.activity({ mode: "studio" });
    sockets[0]!.drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    sockets[2]!.open();
    expect(sockets[2]!.sent[0]).toEqual({ t: "hello", token: "tok", mode: "studio" });
  });

  it("stops if the PC refuses the session, and after close()", () => {
    const a = setup();
    a.sockets[0]!.drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(a.sockets).toHaveLength(1);
    expect(a.statuses().at(-1)).toBe("Log in to join the class");

    const b = setup();
    b.t.close();
    b.sockets[0]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(b.sockets).toHaveLength(1);
    expect(b.sockets[0]!.closed).toBe(true);
  });
});
