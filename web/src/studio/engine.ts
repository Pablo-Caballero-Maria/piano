/**
 * The Studio: a piano roll like FL Studio's. X = time (beats), Y = pitch (frequency).
 * Draw notes with the mouse or a finger (gestures.ts), play them, record new ones live from the
 * piano, undo/redo, loop and metronome. Where notes overlap, the buzzer plays their resultant
 * frequency (lib/notes.ts), and so does this device.
 *
 * In a lesson, the live teacher's piano roll is shared (studioState(), `changes`) and students
 * follow it read-only (follow()), in step with the teacher's playback.
 *
 * The engine keeps the melody and draws the roll itself (roll-view.ts: hundreds of notes and a
 * playhead moving every frame); the toolbar and dialogs are React components that read its
 * `store` and call its methods. Saving and opening melodies is library.ts.
 */
import { KeyboardController } from "@/lib/keyboard-controller";
import { decodeNotes, encodeNotes, type MelodySummary, type Note } from "@/lib/melody";
import { resultant } from "@/lib/notes";
import { readItem, STORAGE_KEYS, writeItem } from "@/lib/storage";
import { Emitter, Store } from "@/lib/store";
import { buildSegments, segmentAt, type Segment } from "@/lib/timeline";
import { UndoHistory } from "@/lib/history";
import { formatTime } from "@/lib/format";
import type { StudioShare } from "@/services/link/messages";
import type { ToastKind } from "@/state/toast";
import {
  BEATS_PER_BAR,
  DEFAULT_BPM,
  DEFAULT_NAME,
  GAP_SEC,
  HIGH,
  LOW,
  MAX_BPM,
  MAX_UNDO,
  MIN_BPM,
  MIN_LEN,
} from "./constants";
import { loadDraft, saveDraft } from "./draft";
import { attachRuler, GridGestures, KeyColumn, listen, type EditorHost } from "./gestures";
import { RollView } from "./roll-view";
import type { EditorMelody, EditorNote, StudioChange, Tool } from "./types";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** What the toolbar shows. */
export interface StudioSnapshot {
  id: string | null;
  name: string;
  bpm: number;
  isPublic: boolean;
  /** Who owns the melody (null: not saved yet). */
  owner: string | null;
  /** Changed since it was last saved or opened. */
  dirty: boolean;
  playing: boolean;
  recording: boolean;
  looping: boolean;
  metronome: boolean;
  tool: Tool;
  snap: number;
  canUndo: boolean;
  canRedo: boolean;
  /** The teacher whose piano roll is shown (read-only), or null. */
  following: string | null;
  /** What sounds now, and its resultant frequency. */
  sounding: number[];
  freq: number;
  keyboardHidden: boolean;
}

export interface StudioDeps {
  sound: {
    output(f: number, midi: readonly number[]): void;
    unlockAudio(): void;
    click(accent: boolean): void;
  };
  toast: (message: string, kind?: ToastKind) => void;
  now?: () => number;
}

/** The live teacher's roll as the studio follows it. */
export type FollowedRoll = StudioShare & { teacher?: string | null };

/** A melody to put in the editor. */
export interface LoadableMelody {
  id: string | null;
  name: string;
  bpm: number;
  notes: readonly Note[];
  public?: boolean;
  owner?: string | null;
}

const FIRST_CLOCK = "1.1  0:00.0 / 0:00.0";

export class StudioEngine {
  readonly store: Store<StudioSnapshot>;
  /** "bar.beat  time / length", updated while playing (its own store: it changes every frame). */
  readonly clock = new Store<string>(FIRST_CLOCK);
  /** Edits, play/stop/seek and opened melodies (for the class). */
  readonly changes = new Emitter<StudioChange>();
  /** Ctrl+S was pressed. */
  readonly saveShortcut = new Emitter<void>();
  /** The keyboard under the roll. */
  readonly keyboard: KeyboardController;

  private melody: EditorMelody = {
    id: null,
    name: "",
    bpm: DEFAULT_BPM,
    notes: [],
    public: false,
    owner: null,
  };
  private dirty = false;
  private uid = 1; // ids for notes on this page (not saved)
  private readonly sel = new Set<number>();
  private snap = 0.25;
  private lastLength = 1;
  private tool: Tool = "draw";
  private active = false; // the studio is the visible mode
  private readonly history = new UndoHistory<string>(MAX_UNDO);

  // Transport
  private playing = false;
  private recording = false;
  private looping = false;
  private metronome = false;
  private cursor = 0; // where Play starts (beats)
  private anchorBeat = 0;
  private anchorTime = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private lastBeat = -1;
  private segments: Segment[] = [];
  private segmentsDirty = true;
  private playPitches: number[] = [];
  private playIds = new Set<number>();

  // Live input (studio keyboard, key column, computer keys) and the note being edited
  private readonly live = new Map<number, number>(); // midi → how many inputs hold it
  private readonly recHeld = new Map<number, EditorNote[]>(); // midi → notes being recorded for it
  private recUndo: string | null = null;
  private recTook = false;
  private previewPitch = 0;
  private previewToken = 0;
  private lastMixKey = "";

  // Following the teacher
  private followed: FollowedRoll | null = null;
  private ownWork: { melody: LoadableMelody; dirty: boolean } | null = null;
  private lastFollowKey = "";

  // The DOM (while attached)
  private view: RollView | null = null;
  private gestures: GridGestures | null = null;
  private keyColumn: KeyColumn | null = null;
  private detachers: (() => void)[] = [];
  private scrollPending = true;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private draftLoaded = false;
  private readonly now: () => number;

  constructor(private readonly deps: StudioDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.keyboard = new KeyboardController(
      { onDown: (m) => this.liveDown(m), onUp: (m) => this.liveUp(m) },
      4,
    );
    this.store = new Store<StudioSnapshot>({
      id: null,
      name: "",
      bpm: DEFAULT_BPM,
      isPublic: false,
      owner: null,
      dirty: false,
      playing: false,
      recording: false,
      looping: false,
      metronome: false,
      tool: "draw",
      snap: this.snap,
      canUndo: false,
      canRedo: false,
      following: null,
      sounding: [],
      freq: 0,
      keyboardHidden: false,
    });
  }

  // ---- The toolbar's view of it ---------------------------------------------------------------

  private update(fields: Partial<StudioSnapshot>): void {
    const cur = this.store.get();
    const same = (Object.keys(fields) as (keyof StudioSnapshot)[]).every((k) => {
      const a = fields[k];
      const b = cur[k];
      return Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((x, i) => x === b[i])
        : Object.is(a, b);
    });
    if (!same) this.store.set({ ...cur, ...fields });
  }

  private syncFile(): void {
    const m = this.melody;
    this.update({
      id: m.id,
      name: m.name,
      bpm: m.bpm,
      isPublic: m.public,
      owner: m.owner,
      dirty: this.dirty,
    });
  }

  private syncTransport(): void {
    this.update({
      playing: this.playing,
      recording: this.recording,
      looping: this.looping,
      metronome: this.metronome,
    });
  }

  private syncHistory(): void {
    this.update({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }

  // ---- Attaching to the page ------------------------------------------------------------------

  /** Draw the roll into `roll` and handle its mouse/touch input (until detach()). */
  attach(roll: HTMLElement): void {
    this.detach();
    const view = new RollView(roll);
    this.view = view;
    this.updateExtent(true);
    this.gestures = new GridGestures(this.editorHost(view));
    this.keyColumn = new KeyColumn(view, {
      down: (m) => this.liveDown(m),
      up: (m) => this.liveUp(m),
      unlockAudio: () => this.deps.sound.unlockAudio(),
    });
    this.detachers = [
      attachRuler(view, {
        seek: (b) => this.seek(b),
        snapRound: (b) => this.snapRound(b),
        recording: () => this.recording,
      }),
      // Ctrl + wheel (or a trackpad pinch) zooms the time axis
      listen(
        roll,
        "wheel",
        (e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
        },
        { passive: false },
      ),
    ];
    // Leaving the page (reload, closing the tab): keep the latest edit, not the one 400 ms ago
    const flush = () => this.flushDraft();
    window.addEventListener("pagehide", flush);
    this.detachers.push(() => window.removeEventListener("pagehide", flush));
    view.setTool(this.tool === "erase");
    view.setReadOnly(!!this.followed);
    if (!this.draftLoaded) {
      this.draftLoaded = true;
      this.update({ keyboardHidden: readItem(STORAGE_KEYS.studioKeyboard) === "0" });
      this.restoreDraft();
    }
    this.drawNotes();
    this.scrollPending = true;
    if (this.active) requestAnimationFrame(() => this.scrollToNotes());
    this.drawPlayhead();
  }

  detach(): void {
    this.stop();
    this.gestures?.destroy();
    this.keyColumn?.destroy();
    for (const off of this.detachers) off();
    this.view?.destroy();
    this.view = this.gestures = this.keyColumn = null;
    this.detachers = [];
  }

  private editorHost(view: RollView): EditorHost {
    const engine = this; // eslint-disable-line @typescript-eslint/no-this-alias -- for the accessors below
    return {
      view,
      readOnly: () => !!this.followed,
      tool: () => this.tool,
      snap: () => this.snap,
      snapRound: (b) => this.snapRound(b),
      snapFloor: (b) => this.snapFloor(b),
      notes: () => this.melody.notes,
      noteById: (id) => this.noteById(id),
      selection: this.sel,
      drawSelection: () => this.drawSelection(),
      selectOnly: (notes) => this.selectOnly(notes),
      snapshot: () => this.snapshot(),
      pushUndo: (state) => this.pushUndo(state),
      checkpoint: () => this.checkpoint(),
      addNote: (p, s, d) => this.addNote(p, s, d),
      removeNotes: (notes) => this.removeNotes(notes),
      drawNote: (n) => this.drawNote(n),
      changed: () => this.changed(),
      updateExtent: () => this.updateExtent(),
      setPreview: (p) => this.setPreview(p),
      flashPreview: (p) => this.flashPreview(p),
      get lastLength() {
        return engine.lastLength;
      },
      set lastLength(len: number) {
        engine.lastLength = len;
      },
      unlockAudio: () => this.deps.sound.unlockAudio(),
    };
  }

  // ---- Helpers --------------------------------------------------------------------------------

  private noteById = (id: number): EditorNote | undefined => this.melody.notes.find((n) => n.id === id);
  private plainNotes = (): Note[] =>
    this.melody.notes.filter((n) => !n.rec).map(({ p, s, d }) => ({ p, s, d }));
  private lengthBeats = (): number =>
    this.melody.notes.reduce((end, n) => (n.rec ? end : Math.max(end, n.s + n.d)), 0);
  private snapRound = (b: number): number => (this.snap ? Math.round(b / this.snap) * this.snap : b);
  private snapFloor = (b: number): number => (this.snap ? Math.floor(b / this.snap + 1e-9) * this.snap : b);
  private beatsToSec = (b: number): number => (b * 60) / this.melody.bpm;

  /** Make the timeline long enough for the melody (plus 4 empty bars) and the playhead. */
  private updateExtent(force = false, upTo = 0): void {
    const recEnds = this.melody.notes.filter((n) => n.rec).map((n) => n.s + n.d);
    this.view?.setExtent(Math.max(this.lengthBeats(), upTo, ...recEnds), force);
  }

  // ---- Drawing notes ------------------------------------------------------------------------

  private drawNote(n: EditorNote): void {
    this.view?.drawNote(n, { selected: this.sel.has(n.id), playing: this.playIds.has(n.id) });
  }

  /** Sync every note element with the melody (adds, updates, removes). */
  private drawNotes(): void {
    this.view?.drawNotes(this.melody.notes, (n) => ({
      selected: this.sel.has(n.id),
      playing: this.playIds.has(n.id),
    }));
    this.updateExtent();
  }

  private drawSelection(): void {
    for (const n of this.melody.notes) this.view?.setNoteClass(n.id, "sel", this.sel.has(n.id));
  }

  private selectOnly(notes: readonly EditorNote[]): void {
    this.sel.clear();
    for (const n of notes) this.sel.add(n.id);
    this.drawSelection();
  }

  // ---- Undo / changes -----------------------------------------------------------------------

  private snapshot = (): string => JSON.stringify({ bpm: this.melody.bpm, notes: this.plainNotes() });

  /** Remember a state (taken before a change) so Undo can go back to it. */
  private pushUndo(state: string): void {
    this.history.push(state);
    this.syncHistory();
  }

  private checkpoint(): void {
    this.pushUndo(this.snapshot());
  }

  private restore(state: string): void {
    const o = JSON.parse(state) as { bpm: number; notes: Note[] };
    this.melody.bpm = o.bpm;
    this.melody.notes = o.notes.map((n) => ({ ...n, id: this.uid++ }));
    this.sel.clear();
    this.drawNotes();
    this.changed();
  }

  undo(): void {
    if (this.recording) return;
    const before = this.history.undo(this.snapshot());
    if (before !== undefined) this.restore(before);
    this.syncHistory();
  }

  redo(): void {
    if (this.recording) return;
    const after = this.history.redo(this.snapshot());
    if (after !== undefined) this.restore(after);
    this.syncHistory();
  }

  /** After any edit to the melody. */
  private changed(): void {
    this.dirty = true;
    this.segmentsDirty = true;
    this.updateExtent();
    this.syncFile();
    this.scheduleDraft();
    this.changes.emit("edit");
  }

  private addNote(p: number, s: number, d: number): EditorNote {
    const n: EditorNote = { id: this.uid++, p, s: Math.max(0, s), d };
    this.melody.notes.push(n);
    this.drawNote(n);
    return n;
  }

  private removeNotes(list: readonly EditorNote[]): void {
    const ids = new Set(list.map((n) => n.id));
    if (!ids.size) return;
    this.melody.notes = this.melody.notes.filter((n) => !ids.has(n.id));
    for (const id of ids) this.sel.delete(id);
    this.drawNotes();
  }

  private deleteSelected(): void {
    if (!this.sel.size) return;
    this.checkpoint();
    this.removeNotes(this.melody.notes.filter((n) => this.sel.has(n.id)));
    this.changed();
  }

  /** Move the selected notes by ds beats and dp semitones (arrow keys). */
  private nudge(ds: number, dp: number): void {
    const list = this.melody.notes.filter((n) => this.sel.has(n.id));
    if (!list.length) return;
    const minS = Math.min(...list.map((n) => n.s));
    const minP = Math.min(...list.map((n) => n.p));
    const maxP = Math.max(...list.map((n) => n.p));
    ds = Math.max(ds, -minS);
    dp = clamp(dp, LOW - minP, HIGH - maxP);
    if (!ds && !dp) return;
    this.checkpoint();
    for (const n of list) {
      n.s += ds;
      n.p += dp;
      this.drawNote(n);
    }
    this.changed();
    if (dp && list.length === 1) this.flashPreview(list[0]!.p);
  }

  // ---- What sounds ----------------------------------------------------------------------------

  /**
   * Combine everything that should sound right now (playback, live keys, the note being edited)
   * into one frequency for the buzzer: the resultant of all those notes.
   */
  private mix(): void {
    if (!this.active) return;
    const pitches = [
      ...new Set([
        ...this.playPitches,
        ...this.live.keys(),
        ...(this.previewPitch ? [this.previewPitch] : []),
      ]),
    ].sort((a, b) => a - b);
    const f = resultant(pitches);
    this.deps.sound.output(f, pitches);
    const key = pitches.join(",");
    if (key === this.lastMixKey) return;
    this.lastMixKey = key;
    this.view?.lightKeys(pitches);
    this.update({ sounding: pitches, freq: f });
  }

  private setPreview(p: number): void {
    this.previewToken++;
    if (p === this.previewPitch) return;
    this.previewPitch = p;
    this.mix();
  }

  /** Play note p briefly (after adding or transposing a note without a held pointer). */
  private flashPreview(p: number): void {
    this.setPreview(p);
    const token = this.previewToken;
    setTimeout(() => {
      if (token === this.previewToken) this.setPreview(0);
    }, 180);
  }

  private liveDown(m: number): void {
    this.deps.sound.unlockAudio();
    this.live.set(m, (this.live.get(m) ?? 0) + 1);
    if (this.recording && this.playing && m >= LOW && m <= HIGH) {
      const n: EditorNote = { id: this.uid++, p: m, s: this.pos(), d: 1e-3, rec: true };
      this.melody.notes.push(n);
      const held = this.recHeld.get(m) ?? [];
      held.push(n);
      this.recHeld.set(m, held);
      this.drawNote(n);
    }
    this.mix();
  }

  private liveUp(m: number): void {
    const count = (this.live.get(m) ?? 0) - 1;
    if (count > 0) this.live.set(m, count);
    else this.live.delete(m);
    const n = this.recHeld.get(m)?.shift();
    if (n) this.finishRecordedNote(n, this.pos());
    this.mix();
  }

  // ---- Playback -------------------------------------------------------------------------------

  /** Current playback position in beats (the start cursor when stopped). */
  private pos(): number {
    return this.playing
      ? this.anchorBeat + ((this.now() - this.anchorTime) * this.melody.bpm) / 60000
      : this.cursor;
  }

  /** End of the loop: the melody rounded up to whole bars. */
  private loopEnd(): number {
    return Math.max(BEATS_PER_BAR, Math.ceil(this.lengthBeats() / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR);
  }

  private setPlayIds(ids: Set<number>): void {
    for (const id of this.playIds) if (!ids.has(id)) this.view?.setNoteClass(id, "on", false);
    for (const id of ids) this.view?.setNoteClass(id, "on", true);
    this.playIds = ids;
  }

  /** Scheduler: sets what sounds at the current position, then sleeps until the next change. */
  private tick = (): void => {
    this.timer = undefined;
    if (!this.playing) return;
    if (this.segmentsDirty) {
      this.segments = buildSegments(
        this.melody.notes.filter((n) => !n.rec),
        (GAP_SEC * this.melody.bpm) / 60,
      );
      this.segmentsDirty = false;
    }
    let p = this.pos();
    const end = this.recording ? Infinity : this.looping ? this.loopEnd() : this.lengthBeats();
    if (p >= end) {
      if (this.looping && end > 0) {
        this.anchorBeat = 0;
        this.anchorTime = this.now();
        p = 0;
        this.lastBeat = -1;
      } else {
        this.stop();
        return;
      }
    }
    const seg = segmentAt(this.segments, p);
    this.playPitches = seg ? seg.pitches : [];
    this.setPlayIds(seg ? seg.ids : new Set());
    if (this.metronome) {
      const b = Math.floor(p + 1e-6);
      if (b > this.lastBeat) {
        this.lastBeat = b;
        this.deps.sound.click(b % BEATS_PER_BAR === 0);
      }
    }
    this.mix();
    const next = Math.min(seg ? seg.t1 : Infinity, this.metronome ? this.lastBeat + 1 : Infinity, end);
    const ms = ((next - p) * 60000) / this.melody.bpm;
    this.timer = setTimeout(this.tick, clamp(ms, 1, 30)); // wake at least every 30 ms to pick up edits
  };

  /** Animation: playhead, clock, auto-scroll, and notes growing while being recorded. */
  private frame = (): void => {
    if (!this.playing) return;
    const p = this.pos();
    if (this.recording) {
      for (const list of this.recHeld.values()) {
        for (const n of list) {
          n.d = Math.max(1e-3, p - n.s);
          this.drawNote(n);
        }
      }
      this.updateExtent(false, p);
    }
    this.drawPlayhead(p);
    if (!this.gestures?.busy) this.view?.follow(p);
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawPlayhead(p = this.pos()): void {
    this.view?.drawPlayhead(p, this.cursor);
    const bar = Math.floor(p / BEATS_PER_BAR) + 1;
    const beat = Math.floor(p % BEATS_PER_BAR) + 1;
    this.clock.set(
      `${bar}.${beat}  ${formatTime(this.beatsToSec(p))} / ${formatTime(this.beatsToSec(this.lengthBeats()))}`,
    );
  }

  play(): void {
    if (this.playing) return;
    this.deps.sound.unlockAudio();
    if (!this.recording && !this.looping && this.cursor >= this.lengthBeats()) this.cursor = 0;
    this.playing = true;
    this.anchorBeat = this.cursor;
    this.anchorTime = this.now();
    this.lastBeat = Math.ceil(this.cursor - 1e-6) - 1;
    this.segmentsDirty = true;
    this.syncTransport();
    this.tick();
    this.frame();
    this.changes.emit("transport");
  }

  stop(): void {
    if (!this.playing) return;
    if (this.recording) this.finishRecording();
    this.playing = this.recording = false;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    this.playPitches = [];
    this.setPlayIds(new Set());
    this.mix();
    this.drawPlayhead();
    this.syncTransport();
    this.changes.emit("transport");
  }

  togglePlay(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  /** Jump the playhead (and the start cursor) to beat b. */
  seek(b: number): void {
    this.cursor = Math.max(0, b);
    if (this.playing && !this.recording) {
      this.anchorBeat = this.cursor;
      this.anchorTime = this.now();
      this.lastBeat = Math.ceil(this.cursor - 1e-6) - 1;
      clearTimeout(this.timer);
      this.tick();
    }
    this.drawPlayhead();
    this.changes.emit("transport");
  }

  toggleLoop(): void {
    this.looping = !this.looping;
    this.syncTransport();
  }

  toggleMetronome(): void {
    this.metronome = !this.metronome;
    this.deps.sound.unlockAudio();
    this.lastBeat = Math.floor(this.pos() + 1e-6);
    this.syncTransport();
  }

  // ---- Recording from the piano ---------------------------------------------------------------

  toggleRecord(): void {
    if (this.recording) {
      this.stop();
      return;
    }
    this.stop();
    this.deps.sound.unlockAudio();
    this.recUndo = this.snapshot();
    this.recTook = false;
    this.recording = true;
    this.play();
    this.deps.toast("Recording: play the piano. Press ● or Stop to finish.");
  }

  /** A recorded key was released at beat `end`: snap it to the grid and keep it. */
  private finishRecordedNote(n: EditorNote, end: number): void {
    const s = this.snapRound(n.s);
    let e = this.snapRound(end);
    const min = this.snap || MIN_LEN;
    if (e - s < min) e = s + min;
    n.s = Math.max(0, s);
    n.d = e - n.s;
    delete n.rec;
    if (!this.recTook && this.recUndo !== null) {
      this.pushUndo(this.recUndo); // one Undo removes the whole take
      this.recTook = true;
    }
    this.drawNote(n);
    this.changed();
  }

  private finishRecording(): void {
    const p = this.pos();
    for (const list of this.recHeld.values()) for (const n of list) this.finishRecordedNote(n, p);
    this.recHeld.clear();
  }

  // ---- Toolbar --------------------------------------------------------------------------------

  setTool(tool: Tool): void {
    this.tool = tool;
    this.view?.setTool(tool === "erase");
    this.update({ tool });
  }

  setSnap(snap: number): void {
    this.snap = snap;
    this.update({ snap });
  }

  /** Change the tempo (kept between 20 and 400 BPM); returns the tempo set. */
  setBpm(value: number): number {
    const bpm = Math.round(clamp(Number(value) || DEFAULT_BPM, MIN_BPM, MAX_BPM));
    if (bpm === this.melody.bpm) return bpm;
    this.checkpoint();
    if (this.playing) {
      this.anchorBeat = this.pos();
      this.anchorTime = this.now();
    }
    this.melody.bpm = bpm;
    this.changed();
    this.drawPlayhead();
    return bpm;
  }

  setName(name: string): void {
    this.melody.name = name;
    this.dirty = true;
    this.syncFile();
    this.scheduleDraft();
  }

  togglePublic(): void {
    this.melody.public = !this.melody.public;
    this.dirty = true;
    this.syncFile();
    this.scheduleDraft();
    this.deps.toast(
      this.melody.public
        ? "Public: everyone will see and can edit it (press Save)"
        : "Private: only you (press Save)",
    );
  }

  /** Zoom the time axis by `factor`, around screen x (default: the middle). */
  zoom(factor: number, anchorX?: number): void {
    if (!this.view) return;
    this.view.setZoom(this.view.ppb * factor, anchorX);
    this.drawPlayhead();
  }

  toggleKeyboard(): void {
    const hidden = !this.store.get().keyboardHidden;
    if (hidden) this.keyboard.releaseAll();
    writeItem(STORAGE_KEYS.studioKeyboard, hidden ? "0" : "1");
    this.update({ keyboardHidden: hidden });
  }

  // ---- The melody as a file (library.ts saves and opens it) ----------------------------------

  /** The melody's name as shown (never empty). */
  displayName(): string {
    return this.melody.name.trim() || DEFAULT_NAME;
  }

  /** Has notes that aren't saved (opening another melody would lose them). */
  hasUnsavedNotes(): boolean {
    return this.dirty && this.melody.notes.length > 0;
  }

  isFollowing(): boolean {
    return !!this.followed;
  }

  /** What Save sends: the melody, its id if it was saved before. */
  current() {
    const m = this.melody;
    return {
      id: m.id,
      draft: { name: this.displayName(), bpm: m.bpm, notes: this.plainNotes(), public: m.public },
    };
  }

  /** The server saved it as `m`. */
  markSaved(m: MelodySummary): void {
    Object.assign(this.melody, { id: m.id, name: m.name, public: m.public, owner: m.owner });
    this.dirty = false;
    this.syncFile();
    this.storeDraft();
  }

  /** Melody `id` was deleted: if it's the one open, it becomes a new, unsaved one. */
  forget(id: string): void {
    if (this.melody.id !== id) return;
    this.melody.id = null;
    this.dirty = true;
    this.syncFile();
    this.storeDraft();
  }

  /** Stop recording (before saving). */
  stopRecording(): void {
    if (this.recording) this.stop();
  }

  /** Start a new, empty melody (same tempo). */
  newMelody(): void {
    this.load({ id: null, name: "", bpm: this.melody.bpm, notes: [], public: false, owner: null });
  }

  /** Put a melody in the editor (clears the undo history). */
  load(m: LoadableMelody): void {
    this.stop();
    this.melody = {
      id: m.id,
      name: m.name,
      bpm: m.bpm,
      notes: m.notes.map(({ p, s, d }) => ({ id: this.uid++, p, s, d })),
      public: !!m.public,
      owner: m.owner ?? null,
    };
    this.sel.clear();
    this.history.clear();
    this.dirty = false;
    this.cursor = 0;
    this.segmentsDirty = true;
    this.drawNotes();
    this.syncHistory();
    this.syncFile();
    this.drawPlayhead();
    this.scrollToNotes();
    this.storeDraft();
    this.changes.emit("load");
  }

  /** Scroll so the melody's notes (or the middle of the keyboard) are in view. */
  private scrollToNotes(): void {
    const ps = this.melody.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 66;
    this.scrollPending = !this.view?.scrollTo(mid);
  }

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      this.storeDraft();
    }, 400);
  }

  /** Store a draft that is waiting to be stored, now. */
  private flushDraft(): void {
    if (this.draftTimer === undefined) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    this.storeDraft();
  }

  /** Keep the work in progress in this browser (not the teacher's roll: it isn't mine). */
  private storeDraft(): void {
    if (this.followed) return;
    const m = this.melody;
    saveDraft({
      id: m.id,
      name: m.name,
      bpm: m.bpm,
      notes: this.plainNotes(),
      public: m.public,
      owner: m.owner,
      dirty: this.dirty,
    });
  }

  private restoreDraft(): void {
    const d = loadDraft();
    if (!d) return;
    this.load(d);
    this.dirty = d.dirty;
    this.syncFile();
  }

  // ---- The page ---------------------------------------------------------------------------------

  /** Show (true) or hide (false) the studio; hiding stops playback and lets go of every key. */
  setActive(on: boolean): void {
    if (!on) {
      this.stop();
      this.keyboard.releaseAll();
      this.live.clear();
      this.previewPitch = 0;
      this.lastMixKey = "";
    }
    this.active = on;
    if (on) {
      if (this.scrollPending) requestAnimationFrame(() => this.scrollToNotes());
      this.mix();
    }
  }

  /** Stop and let go of everything (the window lost focus, or the tab was hidden). */
  panic(): void {
    this.stop();
    this.keyboard.releaseAll();
    this.keyColumn?.releaseAll();
    this.live.clear();
    this.previewPitch = 0;
    this.mix();
  }

  /** The studio's keyboard shortcuts; true if the key was used. */
  keyDown(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const editing = ["Delete", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code,
    );
    if (this.followed && (mod || editing)) return false; // read-only while following the teacher
    if (mod && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && e.code === "KeyY") {
      e.preventDefault();
      this.redo();
      return true;
    }
    if (mod && e.code === "KeyA") {
      e.preventDefault();
      this.selectOnly(this.melody.notes);
      return true;
    }
    if (mod && e.code === "KeyS") {
      e.preventDefault();
      this.saveShortcut.emit();
      return true;
    }
    if (mod || e.altKey) return false;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        if (!e.repeat) this.togglePlay();
        return true;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        this.deleteSelected();
        return true;
      case "Escape":
        this.selectOnly([]);
        return true;
      case "ArrowUp":
      case "ArrowDown":
        if (!this.sel.size) return false;
        e.preventDefault();
        this.nudge(0, (e.code === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1));
        return true;
      case "ArrowLeft":
      case "ArrowRight":
        if (!this.sel.size) return false;
        e.preventDefault();
        this.nudge((e.code === "ArrowRight" ? 1 : -1) * (this.snap || 0.25), 0);
        return true;
    }
    return this.keyboard.keyDown(e);
  }

  keyUp(e: KeyboardEvent): void {
    this.keyboard.keyUp(e);
  }

  // ---- Lessons ----------------------------------------------------------------------------------

  /** What a live teacher shares: the melody (notes as text), the playhead, playing or not. */
  studioState(): StudioShare {
    return {
      melody: { name: this.displayName(), bpm: this.melody.bpm, notes: encodeNotes(this.plainNotes()) },
      playhead: Math.round(this.pos() * 1000) / 1000,
      playing: this.playing,
    };
  }

  /** One line about what I'm doing, for the teacher's list. */
  studioDetail(): string {
    if (this.followed) return "following the teacher's piano roll";
    return `${this.playing ? "playing" : "editing"} "${this.displayName()}"`;
  }

  /**
   * Show the live teacher's piano roll, read-only, in step with their playback.
   * null goes back to my own melody, as I left it.
   */
  follow(roll: FollowedRoll | null): void {
    if (!roll) {
      if (!this.followed) return;
      this.followed = null;
      this.lastFollowKey = "";
      this.view?.setReadOnly(false);
      this.update({ following: null });
      const own = this.ownWork;
      this.ownWork = null;
      if (own) {
        this.load(own.melody);
        this.dirty = own.dirty;
        this.syncFile();
      }
      return;
    }
    if (!this.followed) {
      const m = this.melody;
      this.ownWork = {
        melody: {
          id: m.id,
          name: m.name,
          bpm: m.bpm,
          notes: this.plainNotes(),
          public: m.public,
          owner: m.owner,
        },
        dirty: this.dirty,
      };
      this.view?.setReadOnly(true);
    }
    this.followed = roll;
    this.update({ following: roll.teacher || "the teacher" });
    const m = roll.melody ?? { name: "", bpm: DEFAULT_BPM, notes: "" };
    const key = JSON.stringify([m.name, m.bpm, m.notes]);
    if (key !== this.lastFollowKey) {
      this.lastFollowKey = key;
      this.load({
        id: null,
        name: m.name || "",
        bpm: m.bpm || DEFAULT_BPM,
        notes: decodeNotes(m.notes || ""),
      });
    }
    const at = Number(roll.playhead) || 0;
    if (roll.playing) {
      if (this.playing) {
        this.anchorBeat = at;
        this.anchorTime = this.now();
      } else {
        this.cursor = at;
        this.play();
      }
    } else {
      this.stop();
      this.cursor = at;
      this.drawPlayhead();
    }
  }
}
