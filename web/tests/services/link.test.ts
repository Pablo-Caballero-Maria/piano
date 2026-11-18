// The class link: picks the transport the server says, and routes messages by type.
import { describe, expect, it, vi } from "vitest";
import { ApiClient, type ServerConfig } from "@/services/api";
import { ClassLink } from "@/services/link";
import type { Emit, Transport } from "@/services/link/transport";

function fakeTransport(): Transport & { closed: boolean } {
  return {
    open: true,
    closed: false,
    close() {
      this.closed = true;
    },
    note: vi.fn(),
    activity: vi.fn(),
    live: vi.fn(),
    studio: vi.fn(),
    queue: vi.fn(),
  };
}

function setup(config: ServerConfig, loggedIn = true) {
  const fetchFn = (async () => new Response(JSON.stringify(config))) as unknown as typeof fetch;
  const api = new ApiClient(
    fetchFn,
    loggedIn ? { token: "tok", user: { username: "ana", role: "student" } } : null,
  );
  const made: { kind: string; emit: Emit; transport: ReturnType<typeof fakeTransport> }[] = [];
  const link = new ClassLink(api, {
    classroom: (_token, emit) => {
      const transport = fakeTransport();
      made.push({ kind: "classroom", emit, transport });
      return transport;
    },
    online: (emit) => {
      const transport = fakeTransport();
      made.push({ kind: "online", emit, transport });
      return transport;
    },
  });
  return { link, made };
}

describe("ClassLink", () => {
  it("joins the classroom over WebSocket, or the online lessons over Ably", async () => {
    const a = setup({ mode: "classroom", realtime: "ws" });
    await a.link.start();
    expect(a.made.map((m) => m.kind)).toEqual(["classroom"]);
    expect(a.link.where()).toBe("classroom");
    a.link.note(440, [69]);
    expect(a.made[0]!.transport.note).toHaveBeenCalledWith(440, [69]);

    const b = setup({ mode: "online", realtime: "ably" });
    await b.link.start();
    expect(b.link.where()).toBe("online");
  });

  it("needs a login", async () => {
    const { link, made } = setup({ mode: "classroom", realtime: "ws" }, false);
    const status = vi.fn();
    link.on("status", status);
    await link.start();
    expect(made).toEqual([]);
    expect(status).toHaveBeenCalledWith({ t: "status", state: "off", text: "Log in to join the class" });
  });

  it("routes each message to its handlers; a stopped handler gets nothing", async () => {
    const { link, made } = setup({ mode: "classroom", realtime: "ws" });
    await link.start();
    const lesson = vi.fn();
    const stop = link.on("lesson", lesson);
    made[0]!.emit({ t: "lesson", live: "Profe", mode: "piano" });
    made[0]!.emit({ t: "error", message: "x" });
    stop();
    made[0]!.emit({ t: "lesson", live: null, mode: "piano" });
    expect(lesson).toHaveBeenCalledTimes(1);
  });

  it("starting again closes the old transport; a start overtaken by another does nothing", async () => {
    const { link, made } = setup({ mode: "classroom", realtime: "ws" });
    await link.start();
    const first = link.start();
    const second = link.start();
    await Promise.all([first, second]);
    expect(made).toHaveLength(2);
    expect(made[0]!.transport.closed).toBe(true);
    expect(link.where()).toBe("classroom");
    link.stop();
    expect(link.where()).toBeNull();
    expect(made[1]!.transport.closed).toBe(true);
  });
});
