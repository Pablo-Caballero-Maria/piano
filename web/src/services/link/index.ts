/**
 * The live class link. In the classroom: a WebSocket to the teacher's PC (classroom.ts). Online:
 * Ably channels, one per teacher's lesson (online.ts). The rest of the page uses the same calls
 * and receives the same messages {t: type, …} either way (messages.ts): welcome, lesson,
 * teacher.note, teacher.studio, buzzer, board, people, lessons (online), error, and status (how
 * the link itself is doing).
 */
import { api as defaultApi, type ApiClient } from "../api";
import { loadAbly } from "./ably-sdk";
import { ClassroomTransport } from "./classroom";
import type {
  Activity,
  MessageOf,
  MessageType,
  Mode,
  QueueAction,
  QueueArgs,
  ServerMessage,
  StudioShare,
} from "./messages";
import { OnlineTransport } from "./online";
import type { Emit, Transport } from "./transport";

export type Where = "classroom" | "online" | null;

export interface TransportFactories {
  classroom: (token: string, emit: Emit) => Transport;
  online: (emit: Emit) => Transport;
}

export class ClassLink {
  private handlers = new Map<MessageType, Set<(msg: ServerMessage) => void>>();
  private transport: Transport | null = null;
  private mode: Where = null;
  /** Increases on every start/stop, so an older start() that resolves late does nothing. */
  private generation = 0;
  private readonly factories: TransportFactories;

  constructor(
    private readonly api: ApiClient = defaultApi,
    factories?: Partial<TransportFactories>,
  ) {
    this.factories = {
      classroom: (token, emit) => new ClassroomTransport({ token, emit }),
      online: (emit) => new OnlineTransport({ api: this.api, emit, loadSdk: loadAbly }),
      ...factories,
    };
  }

  /** Call fn(msg) for every message of type t; returns the function that stops it. */
  on<T extends MessageType>(t: T, fn: (msg: MessageOf<T>) => void): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    const handler = fn as (msg: ServerMessage) => void;
    set.add(handler);
    return () => set.delete(handler);
  }

  private emit: Emit = (msg) => {
    for (const fn of [...(this.handlers.get(msg.t) ?? [])]) {
      try {
        fn(msg);
      } catch (e) {
        console.error(e);
      }
    }
  };

  private status(state: "off" | "connecting" | "on", text: string): void {
    this.emit({ t: "status", state, text });
  }

  /** "classroom", "online" or null (not connected). */
  where = (): Where => this.mode;
  connected = (): boolean => !!this.transport?.open;

  /** Connect (needs a login); call again after logging in or out. */
  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    const cfg = await this.api.config();
    if (generation !== this.generation) return; // stopped or restarted meanwhile
    const token = this.api.token();
    if (!token) {
      this.status("off", cfg.mode === "classroom" ? "Log in to join the class" : "Not in a lesson");
      return;
    }
    if (cfg.realtime === "ws") {
      this.mode = "classroom";
      this.transport = this.factories.classroom(token, this.emit);
    } else if (cfg.realtime === "ably") {
      this.mode = "online";
      this.transport = this.factories.online(this.emit);
    } else {
      this.status("off", "Offline");
    }
  }

  stop(): void {
    this.generation++;
    const transport = this.transport;
    this.transport = null;
    this.mode = null; // before close(): its last status is no longer from a class
    transport?.close();
  }

  // What the page reports; the transport decides where it goes
  note = (freq: number, midi: number[]): void => this.transport?.note(freq, midi);
  activity = (a: Activity): void => this.transport?.activity(a);
  live = (on: boolean, mode: Mode): void => this.transport?.live(on, mode);
  studio = (state: StudioShare): void => this.transport?.studio(state);
  queue = (action: QueueAction, args: QueueArgs = {}): void => this.transport?.queue?.(action, args);
  follow = async (teacher: string | null): Promise<void> => this.transport?.follow?.(teacher);
  lessons = async (): Promise<void> => this.transport?.lessons?.();
}

/** The page's class link. */
export const link = new ClassLink();

export type * from "./messages";
