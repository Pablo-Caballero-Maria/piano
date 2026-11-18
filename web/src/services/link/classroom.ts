/**
 * The class in the classroom: a WebSocket to the teacher's PC (fog/classroom.py), at /ws on the
 * page's own host. It says hello with the session token, then sends and receives {t: …} messages;
 * if the connection drops it reconnects, waiting 1 s, 2 s, 4 s… up to 15 s.
 */
import type { Activity, Mode, QueueAction, QueueArgs, ServerMessage, StudioShare } from "./messages";
import type { Emit, Transport } from "./transport";

/** The PC closes with this code when the session isn't valid. */
export const CLOSE_UNAUTHORIZED = 4401;
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 15000;

export interface ClassroomOptions {
  token: string;
  emit: Emit;
  url?: string;
  createSocket?: (url: string) => WebSocket;
}

export function classroomUrl(loc: Pick<Location, "protocol" | "host"> = location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

export class ClassroomTransport implements Transport {
  open = false;
  private closed = false;
  private retryMs = FIRST_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private ws: WebSocket | null = null;
  /** What I'm doing (sent again in the hello after reconnecting). */
  private last: Activity = { mode: "piano" };
  private readonly url: string;
  private readonly createSocket: (url: string) => WebSocket;

  constructor(private readonly opts: ClassroomOptions) {
    this.url = opts.url ?? classroomUrl();
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
    this.connect();
  }

  private status(state: "off" | "connecting" | "on", text: string): void {
    this.opts.emit({ t: "status", state, text });
  }

  private connect(): void {
    this.status("connecting", "Joining the class…");
    const ws = this.createSocket(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: this.opts.token, mode: this.last.mode }));
    ws.onmessage = (e: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === "welcome") {
        this.open = true;
        this.retryMs = FIRST_RETRY_MS;
        this.status("on", "In class");
      }
      this.opts.emit(msg);
    };
    ws.onclose = (e: CloseEvent) => {
      this.open = false;
      if (this.closed) return;
      if (e.code === CLOSE_UNAUTHORIZED) {
        this.status("off", "Log in to join the class");
        return;
      }
      this.status("connecting", "Lost the class, reconnecting…");
      this.retryTimer = setTimeout(() => !this.closed && this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }

  private send(msg: object): void {
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.status("off", "Not in class");
  }

  note(freq: number, midi: number[]): void {
    this.send({ t: "note", freq, midi });
  }

  activity(a: Activity): void {
    this.last = { ...this.last, ...a };
    this.send({ t: "activity", ...a });
  }

  live(on: boolean, mode: Mode): void {
    this.send({ t: "live", on, mode });
  }

  studio(state: StudioShare): void {
    this.send({ t: "studio", ...state });
  }

  queue(action: QueueAction, args: QueueArgs): void {
    this.send({ t: `queue.${action}`, ...args });
  }
}
