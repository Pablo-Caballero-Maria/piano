/**
 * The class, as this page sees it: the live lesson, the buzzer queue, the board, and (for
 * teachers) who is here and what each one is doing. It follows the class link's messages and
 * keeps them in a store the components read; the actions go back through the link.
 */
import type { ApiClient } from "@/services/api";
import type { ClassLink, Where } from "@/services/link";
import type {
  BoardState,
  BuzzerState,
  ConnectionState,
  Lesson,
  Mode,
  Person,
  QueueAction,
  QueueArgs,
  StudioShare,
} from "@/services/link/messages";
import { Emitter, Store } from "@/lib/store";
import { toast as defaultToast, type ToastKind } from "./toast";

export interface ClassSnapshot {
  status: { state: ConnectionState; text: string };
  /** In a classroom (the teacher's PC), online (Ably), or neither. */
  where: Where;
  lesson: Lesson;
  buzzer: BuzzerState;
  board: BoardState | null;
  /** Who is in the class (teachers see it). */
  people: Person[];
  /** Online: lessons happening now. */
  teachers: string[];
  /** Online: the teacher whose lesson I follow. */
  following: string | null;
  /** What the live teacher is playing. */
  teacherNotes: number[];
}

export const INITIAL_CLASS: ClassSnapshot = {
  status: { state: "off", text: "" },
  where: null,
  lesson: { live: null, mode: "piano" },
  buzzer: { holder: null, live: null, granted: null, queue: [] },
  board: null,
  people: [],
  teachers: [],
  following: null,
  teacherNotes: [],
};

/** True if `me` is the teacher giving the lesson right now. */
export const isLive = (s: ClassSnapshot, me: string | null): boolean =>
  !!s.lesson.live && s.lesson.live === me;

/** True if a lesson by someone else is on (and I'm in it). */
export const isWatching = (s: ClassSnapshot, me: string | null): boolean =>
  !!s.lesson.live && s.lesson.live !== me;

/** My place in the buzzer queue (0 = playing or next), or -1. */
export const queuePosition = (s: ClassSnapshot, me: string | null): number =>
  me ? s.buzzer.queue.indexOf(me) : -1;

export class ClassState {
  readonly store = new Store<ClassSnapshot>(INITIAL_CLASS);
  /** The live teacher's piano roll in a studio lesson (null: none), for the studio to follow. */
  readonly teacherRoll = new Emitter<StudioShare | null>();

  constructor(
    private readonly api: ApiClient,
    private readonly link: ClassLink,
    private readonly toast: (message: string, kind?: ToastKind) => void = defaultToast,
  ) {
    link.on("status", (m) =>
      this.store.patch({ status: { state: m.state, text: m.text }, where: link.where() }),
    );
    link.on("welcome", (m) => {
      this.store.patch({
        lesson: { live: m.lesson.live, mode: m.lesson.mode },
        buzzer: m.buzzer,
        board: m.board,
        ...(m.people ? { people: m.people } : {}),
      });
      if (m.studio) this.teacherRoll.emit(m.studio);
    });
    link.on("lesson", (m) => {
      const wasLive = this.store.get().lesson.live;
      this.store.patch({ lesson: { live: m.live, mode: m.mode } });
      if (!m.live || m.mode !== "studio") this.teacherRoll.emit(null);
      if (!m.live) this.store.patch({ teacherNotes: [] });
      if (m.live && m.live !== wasLive && m.live !== this.me()) this.toast(`${m.live} started the lesson`);
    });
    link.on("teacher.note", (m) => this.store.patch({ teacherNotes: m.midi ?? [] }));
    link.on("teacher.studio", ({ t: _t, ...share }) => this.teacherRoll.emit(share));
    link.on("buzzer", ({ t: _t, ...buzzer }) => {
      const me = this.me();
      const had = this.store.get().buzzer.holder === me;
      this.store.patch({ buzzer });
      if (!had && me && buzzer.holder === me && buzzer.live !== me) {
        this.toast("Your turn: you're playing on the buzzer");
      }
    });
    link.on("board", ({ t: _t, ...board }) => this.store.patch({ board }));
    link.on("people", (m) => this.store.patch({ people: m.people }));
    link.on("lessons", (m) => this.store.patch({ teachers: m.teachers }));
    link.on("error", (m) => this.toast(m.message, "error"));
  }

  me = (): string | null => this.api.currentUser()?.username ?? null;
  amLive = (): boolean => isLive(this.store.get(), this.me());
  watchingLesson = (): boolean => isWatching(this.store.get(), this.me());
  queuePosition = (): number => queuePosition(this.store.get(), this.me());

  /** Start (or end) my lesson; it starts in the mode I'm using. */
  toggleLive(currentMode: Mode): void {
    const { lesson } = this.store.get();
    if (this.amLive()) this.link.live(false, lesson.mode);
    else this.link.live(true, currentMode);
  }

  /** Ask for the buzzer, or leave the queue (or give it up) if I'm in it. */
  toggleBuzzerRequest(): void {
    this.link.queue(this.queuePosition() >= 0 ? "leave" : "join");
  }

  queue(action: QueueAction, args: QueueArgs = {}): void {
    this.link.queue(action, args);
  }

  /** Online: follow a teacher's lesson, or stop following (null). */
  async follow(teacher: string | null): Promise<void> {
    this.store.patch({ following: teacher });
    await this.link.follow(teacher);
  }

  /** Online: ask which lessons are live. */
  refreshLessons(): void {
    void this.link.lessons();
  }
}
