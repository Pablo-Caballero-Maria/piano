/**
 * The class online (Vercel): Ably channels, one per teacher's lesson, `class:<teacher>`
 * (pianocore/ably.py). A teacher publishes `lesson`, `note` and `studio` messages on their own
 * channel and sees who follows in its presence; a student subscribes to the lesson they follow
 * and shows what they do in their presence data. Messages reach the page in the classroom's
 * format (messages.ts).
 */
import type { ApiClient } from "../api";
import type { AblyChannel, AblyRealtime, AblySdk } from "./ably-sdk";
import type { Activity, Mode, Person, StudioShare } from "./messages";
import type { Emit, Transport } from "./transport";

/** Ably limits presence updates: the latest is sent at most every 0.5 s. */
const PRESENCE_EVERY_MS = 500;

export const lessonChannel = (teacher: string): string => `class:${teacher.toLowerCase()}`;

export interface OnlineOptions {
  api: ApiClient;
  emit: Emit;
  loadSdk: () => Promise<AblySdk>;
}

export class OnlineTransport implements Transport {
  open = false;
  private closed = false;
  private client: AblyRealtime | null = null;
  /** The lesson channel I follow (students). */
  private following: AblyChannel | null = null;
  /** My own lesson channel (teachers, while live). */
  private own: AblyChannel | null = null;
  private liveOn = false;
  private presence: Activity = { mode: "piano", notes: [], detail: "" };
  private presenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: OnlineOptions) {
    this.start().catch((e: Error) => this.status("off", `Live lessons unavailable: ${e.message}`));
  }

  private status(state: "off" | "connecting" | "on", text: string): void {
    this.opts.emit({ t: "status", state, text });
  }

  private async start(): Promise<void> {
    this.status("connecting", "Connecting…");
    const sdk = await this.opts.loadSdk();
    if (this.closed) return;
    // Tokens come from Vercel (api/index.py) with my username as clientId (required under MAU)
    const client = sdk.createClient({
      authCallback: (_params, cb) => {
        this.opts.api.post("/ably/token").then(
          (tokenRequest) => cb(null, tokenRequest),
          (e: Error) => cb(e.message, null),
        );
      },
    });
    this.client = client;
    client.connection.on("connected", () => {
      this.open = true;
      this.status("on", "Online");
      void this.lessons();
    });
    client.connection.on("disconnected", () => {
      this.open = false;
      this.status("connecting", "Reconnecting…");
    });
    client.connection.on("failed", () => {
      this.open = false;
      this.status("off", "Live lessons unavailable");
    });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.presenceTimer);
    try {
      this.client?.close();
    } catch {
      // already closed
    }
    this.status("off", "Not in a lesson");
  }

  private channel(teacher: string): AblyChannel | null {
    return this.client?.channels.get(lessonChannel(teacher)) ?? null;
  }

  /** Ask which lessons are live (api/index.py reads it from Ably). */
  async lessons(): Promise<void> {
    try {
      const { teachers } = await this.opts.api.get<{ teachers: string[] }>("/live");
      this.opts.emit({ t: "lessons", teachers });
    } catch {
      // not logged in or offline: the list stays as it was
    }
  }

  /** Follow a teacher's lesson (null: stop following). */
  async follow(teacher: string | null): Promise<void> {
    if (this.following) {
      const ch = this.following;
      this.following = null;
      ch.unsubscribe();
      ch.presence.leave().catch(() => {});
      this.opts.emit({ t: "lesson", live: null, mode: "piano" });
    }
    if (!teacher) return;
    const ch = this.channel(teacher);
    if (!ch) return;
    this.following = ch;
    ch.subscribe((m) => {
      const d = (m.data ?? {}) as Record<string, unknown>;
      if (m.name === "lesson") {
        this.opts.emit({ t: "lesson", live: d.live ? teacher : null, mode: (d.mode as Mode) || "piano" });
      } else if (m.name === "note") {
        this.opts.emit({ t: "teacher.note", freq: Number(d.freq) || 0, midi: (d.midi as number[]) || [] });
      } else if (m.name === "studio") {
        this.opts.emit({ t: "teacher.studio", ...(d as unknown as StudioShare) });
      }
    });
    await ch.presence.enter(this.presence);
    this.opts.emit({ t: "lesson", live: teacher, mode: "piano" });
  }

  activity(a: Activity): void {
    this.presence = { ...this.presence, ...a };
    clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(
      () => this.following?.presence.update(this.presence).catch(() => {}),
      PRESENCE_EVERY_MS,
    );
  }

  /** A teacher starts (or ends) their lesson; while live, who follows it is listed as people. */
  async live(on: boolean, mode: Mode): Promise<void> {
    const me = this.opts.api.currentUser()?.username;
    if (!me || !this.opts.api.isTeacher()) return;
    this.own ??= this.channel(me);
    const own = this.own;
    if (!own) return;
    this.liveOn = on;
    await own.publish("lesson", { live: on, mode });
    if (on) {
      const refresh = async () => {
        const members = await own.presence.get();
        const people: Person[] = members
          .filter((p) => p.clientId !== me)
          .map((p) => ({
            id: `ably:${p.clientId}`,
            name: p.clientId,
            role: "student",
            remote: true,
            ...((p.data as Activity | undefined) ?? {}),
          }));
        this.opts.emit({ t: "people", people });
      };
      own.presence.subscribe(() => void refresh());
      void refresh();
    } else {
      own.presence.unsubscribe();
    }
    this.opts.emit({ t: "lesson", live: on ? me : null, mode });
  }

  note(freq: number, midi: number[]): void {
    if (this.liveOn) this.own?.publish("note", { freq, midi }).catch(() => {});
    else this.activity({ notes: midi }); // a student: the teacher sees it in my presence
  }

  studio(state: StudioShare): void {
    if (this.liveOn) this.own?.publish("studio", state).catch(() => {});
  }
}
