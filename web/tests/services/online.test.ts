// Online lessons over Ably (in memory).
import { describe, expect, it } from "vitest";
import { ApiClient } from "@/services/api";
import type { ServerMessage } from "@/services/link/messages";
import { lessonChannel, OnlineTransport } from "@/services/link/online";
import { FakeAbly } from "./fakes";

async function setup(role: "teacher" | "student", name: string) {
  const fetchFn = (async (url: string) =>
    new Response(
      JSON.stringify(url.endsWith("/live") ? { teachers: ["Profe"] } : { keyName: "k", clientId: name }),
    )) as unknown as typeof fetch;
  const api = new ApiClient(fetchFn, { token: "tok", user: { username: name, role } });
  const ably = new FakeAbly();
  const got: ServerMessage[] = [];
  const t = new OnlineTransport({ api, emit: (m) => got.push(m), loadSdk: async () => ably });
  await new Promise((r) => setTimeout(r, 0));
  return { t, ably, got };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("OnlineTransport", () => {
  it("connects with tokens from our server, then lists the live lessons", async () => {
    const { ably, got } = await setup("student", "ana");
    const token = await new Promise((resolve) => ably.authCallback!(null, (_e, tr) => resolve(tr)));
    expect(token).toEqual({ keyName: "k", clientId: "ana" });
    ably.handlers.connected!();
    await tick();
    expect(got).toContainEqual({ t: "status", state: "on", text: "Online" });
    expect(got).toContainEqual({ t: "lessons", teachers: ["Profe"] });
  });

  it("a student follows a lesson: its messages arrive in the classroom's format", async () => {
    const { t, ably, got } = await setup("student", "ana");
    await t.follow("Profe");
    const ch = ably.channels.get(lessonChannel("Profe"))!;
    expect(lessonChannel("Profe")).toBe("class:profe");
    expect(ch.entered).toEqual([{ mode: "piano", notes: [], detail: "" }]);
    ch.listener!({ name: "lesson", data: { live: true, mode: "studio" } });
    ch.listener!({ name: "note", data: { freq: 440, midi: [69] } });
    ch.listener!({
      name: "studio",
      data: { melody: { name: "x", bpm: 90, notes: "" }, playhead: 1, playing: true },
    });
    expect(got.slice(-3)).toEqual([
      { t: "lesson", live: "Profe", mode: "studio" },
      { t: "teacher.note", freq: 440, midi: [69] },
      { t: "teacher.studio", melody: { name: "x", bpm: 90, notes: "" }, playhead: 1, playing: true },
    ]);
    await t.follow(null);
    expect(ch.left).toBe(1);
    expect(got.at(-1)).toEqual({ t: "lesson", live: null, mode: "piano" });
  });

  it("a teacher goes live, publishes notes and sees who follows", async () => {
    const { t, ably, got } = await setup("teacher", "Profe");
    await t.live(true, "piano");
    const ch = ably.channels.get("class:profe")!;
    ch.members = [{ clientId: "Profe" }, { clientId: "ana", data: { mode: "studio", notes: [60] } }];
    ch.presenceListener!();
    await tick();
    expect(got).toContainEqual({
      t: "people",
      people: [{ id: "ably:ana", name: "ana", role: "student", remote: true, mode: "studio", notes: [60] }],
    });
    t.note(262, [60]);
    expect(ch.published).toEqual([
      ["lesson", { live: true, mode: "piano" }],
      ["note", { freq: 262, midi: [60] }],
    ]);
    await t.live(false, "piano");
    expect(ch.presenceListener).toBeNull();
    expect(got.at(-1)).toEqual({ t: "lesson", live: null, mode: "piano" });
  });

  it("students can't go live", async () => {
    const { t, ably } = await setup("student", "ana");
    await t.live(true, "piano");
    expect(ably.channels.size).toBe(0);
  });
});
