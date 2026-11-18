/** What the class link needs from a transport (the classroom's WebSocket, or Ably online). */
import type { Activity, Mode, QueueAction, QueueArgs, ServerMessage, StudioShare } from "./messages";

export interface Transport {
  /** Connected and accepted by the other side. */
  readonly open: boolean;
  close(): void;
  note(freq: number, midi: number[]): void;
  activity(a: Activity): void;
  live(on: boolean, mode: Mode): void;
  studio(state: StudioShare): void;
  queue?(action: QueueAction, args: QueueArgs): void;
  follow?(teacher: string | null): Promise<void>;
  lessons?(): Promise<void>;
}

/** How a transport hands messages to the link. */
export type Emit = (msg: ServerMessage) => void;
