/**
 * The messages of the live class, the same whether they come from the teacher's PC (WebSocket,
 * fog/classroom.py) or from Ably (online, pianocore/ably.py): {t: type, …}.
 */
import type { Role } from "../api";

export type Mode = "piano" | "studio";

export interface Lesson {
  /** The teacher giving the lesson, or null. */
  live: string | null;
  mode: Mode;
}

export interface BuzzerState {
  /** Who plays on the buzzer now. */
  holder: string | null;
  /** The live teacher (who holds it unless they handed it over). */
  live: string | null;
  /** The student the live teacher handed it to. */
  granted: string | null;
  /** Who waits for it, in order (the first one plays when there's no lesson). */
  queue: string[];
}

export interface BoardState {
  online: boolean;
  version?: string;
}

/** Someone in the class, as the teacher sees them. */
export interface Person {
  id: string;
  name: string;
  role: Role;
  mode?: Mode;
  notes?: number[];
  detail?: string;
  /** Following from home (online), not in the classroom. */
  remote?: boolean;
}

/** What a live teacher shares of their piano roll in a studio lesson. */
export interface StudioShare {
  melody: { name: string; bpm: number; notes: string };
  playhead: number;
  playing: boolean;
}

/** What I'm doing, for the teacher's list. */
export interface Activity {
  mode?: Mode;
  detail?: string;
  notes?: number[];
}

export type ConnectionState = "off" | "connecting" | "on";

export type ServerMessage =
  | {
      t: "welcome";
      lesson: Lesson;
      buzzer: BuzzerState;
      board: BoardState | null;
      people?: Person[];
      studio?: StudioShare | null;
    }
  | ({ t: "lesson" } & Lesson)
  | { t: "teacher.note"; freq: number; midi: number[] }
  | ({ t: "teacher.studio" } & StudioShare)
  | ({ t: "buzzer" } & BuzzerState)
  | ({ t: "board" } & BoardState)
  | { t: "people"; people: Person[] }
  | { t: "lessons"; teachers: string[] }
  | { t: "error"; message: string }
  /** Not from the server: how the link itself is doing. */
  | { t: "status"; state: ConnectionState; text: string };

export type MessageType = ServerMessage["t"];
export type MessageOf<T extends MessageType> = Extract<ServerMessage, { t: T }>;

/** What the teacher does with the buzzer queue (the PC checks who may). */
export type QueueAction = "join" | "leave" | "next" | "move" | "remove" | "grant" | "revoke";
export interface QueueArgs {
  user?: string;
  to?: number;
}
