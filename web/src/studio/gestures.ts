/**
 * Mouse and touch on the piano roll:
 *
 * - the grid (GridGestures): click to add a note and drag it; drag a note to move it (with the
 *   other selected ones), its right edge to resize; Shift/Ctrl-click to select, Shift/Ctrl-drag
 *   for a box selection; the erase tool or the right button deletes what it touches. On touch
 *   screens a tap adds a note and a drag scrolls the roll;
 * - the piano-key column (KeyColumn): press a row's key to hear it, slide for a glissando;
 * - the ruler (attachRuler): click or drag to move the start cursor.
 */
import { HIGH, LOW, MIN_LEN } from "./constants";
import type { GridPoint, RollView } from "./roll-view";
import type { EditorNote, Tool } from "./types";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Add an event listener; returns the function that removes it. */
export function listen<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  fn: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  el.addEventListener(type, fn, options);
  return () => el.removeEventListener(type, fn, options);
}

/** What the grid's gestures need from the editor. */
export interface EditorHost {
  readonly view: RollView;
  readOnly(): boolean;
  tool(): Tool;
  snap(): number;
  snapRound(beat: number): number;
  snapFloor(beat: number): number;
  notes(): readonly EditorNote[];
  noteById(id: number): EditorNote | undefined;
  selection: Set<number>;
  drawSelection(): void;
  selectOnly(notes: readonly EditorNote[]): void;
  /** The melody as it is now (for undo). */
  snapshot(): string;
  pushUndo(state: string): void;
  checkpoint(): void;
  addNote(p: number, s: number, d: number): EditorNote;
  removeNotes(notes: readonly EditorNote[]): void;
  drawNote(n: EditorNote): void;
  /** After an edit: marks it unsaved, keeps a draft, tells the class. */
  changed(): void;
  updateExtent(): void;
  /** Sound note p while it's being edited (0: stop). */
  setPreview(p: number): void;
  /** Sound note p briefly. */
  flashPreview(p: number): void;
  /** The length new notes get: the last one touched. */
  lastLength: number;
  unlockAudio(): void;
}

interface Original {
  n: EditorNote;
  s: number;
  p: number;
  d: number;
}

type Drag =
  | { type: "erase"; id: number; before: string; erased: boolean }
  | {
      type: "move" | "resize";
      id: number;
      start: GridPoint;
      anchor: EditorNote;
      orig: Original[];
      before: string;
      moved: boolean;
    }
  | { type: "box"; id: number; x0: number; y0: number; base: Set<number> }
  | { type: "tap"; id: number; x: number; y: number; pt: GridPoint };

export class GridGestures {
  private drag: Drag | null = null;
  private readonly detach: (() => void)[];

  constructor(private readonly host: EditorHost) {
    const grid = host.view.grid;
    this.detach = [
      listen(grid, "pointerdown", (e) => this.down(e)),
      listen(grid, "pointermove", (e) => this.move(e)),
      listen(grid, "pointerup", (e) => this.up(e)),
      listen(grid, "pointercancel", (e) => this.cancel(e)),
      listen(grid, "pointerleave", () => host.view.setHover(0)),
      listen(grid, "contextmenu", (e) => e.preventDefault()),
    ];
  }

  /** True while a gesture is going on (the playback doesn't scroll the roll then). */
  get busy(): boolean {
    return this.drag !== null;
  }

  destroy(): void {
    for (const off of this.detach) off();
  }

  private eraseAt(n: EditorNote | undefined): void {
    const d = this.drag;
    if (!n || d?.type !== "erase") return;
    if (!d.erased) {
      d.erased = true;
      this.host.pushUndo(d.before);
    }
    this.host.removeNotes([n]);
  }

  private down(e: PointerEvent): void {
    const h = this.host;
    if (h.readOnly()) return; // the teacher's roll
    if (this.drag || e.button === 1) return; // one gesture at a time; middle button = the browser's
    h.unlockAudio();
    const noteId = h.view.noteIdOf(e.target);
    const n = noteId === null ? undefined : h.noteById(noteId);
    const pt = h.view.gridPoint(e);
    const touch = e.pointerType !== "mouse";
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    const capture = () => {
      e.preventDefault();
      h.view.grid.setPointerCapture(e.pointerId);
    };

    // Erase tool, or the right mouse button (like FL Studio): delete what you touch
    if (h.tool() === "erase" || e.button === 2) {
      if (!n && touch) return; // a finger on empty space scrolls
      capture();
      this.drag = { type: "erase", id: e.pointerId, before: h.snapshot(), erased: false };
      this.eraseAt(n);
      return;
    }

    if (n) {
      e.preventDefault();
      if (mod) {
        // Shift/Ctrl-click toggles the note in the selection
        if (h.selection.has(n.id)) h.selection.delete(n.id);
        else h.selection.add(n.id);
        h.drawSelection();
        if (!h.selection.has(n.id)) return;
      } else if (!h.selection.has(n.id)) {
        h.selectOnly([n]);
      }
      h.view.grid.setPointerCapture(e.pointerId);
      const resize = (e.target as Element).classList.contains("h");
      if (!resize) h.lastLength = n.d; // new notes copy the length of the last one touched
      const group = h.notes().filter((x) => h.selection.has(x.id));
      this.drag = {
        type: resize ? "resize" : "move",
        id: e.pointerId,
        start: pt,
        anchor: n,
        orig: group.map((x) => ({ n: x, s: x.s, p: x.p, d: x.d })),
        before: h.snapshot(),
        moved: false,
      };
      h.setPreview(n.p);
      return;
    }

    // Empty space
    if (!touch && mod) {
      capture(); // Shift/Ctrl-drag: box selection
      this.drag = {
        type: "box",
        id: e.pointerId,
        x0: pt.x,
        y0: pt.y,
        base: new Set(e.shiftKey ? h.selection : []),
      };
      return;
    }
    if (touch) {
      // A tap adds a note on pointerup; a drag scrolls the roll instead (the browser cancels us)
      this.drag = { type: "tap", id: e.pointerId, x: e.clientX, y: e.clientY, pt };
      return;
    }
    // Mouse click: add a note there and keep dragging it
    capture();
    const before = h.snapshot();
    const created = h.addNote(pt.pitch, h.snapFloor(pt.beat), h.lastLength);
    h.selectOnly([created]);
    this.drag = {
      type: "move",
      id: e.pointerId,
      start: pt,
      anchor: created,
      orig: [{ n: created, s: created.s, p: created.p, d: created.d }],
      before,
      moved: true,
    };
    h.setPreview(created.p);
    h.updateExtent();
  }

  private move(e: PointerEvent): void {
    const h = this.host;
    const d = this.drag;
    if (!d) {
      if (e.pointerType === "mouse") h.view.setHover(h.view.gridPoint(e).pitch);
      return;
    }
    if (e.pointerId !== d.id) return;
    const pt = h.view.gridPoint(e);

    switch (d.type) {
      case "tap":
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) this.drag = null;
        return;

      case "erase": {
        const id = h.view.noteIdAt(e.clientX, e.clientY);
        if (id !== null) this.eraseAt(h.noteById(id));
        return;
      }

      case "box": {
        const x1 = Math.min(d.x0, pt.x);
        const x2 = Math.max(d.x0, pt.x);
        const y1 = Math.min(d.y0, pt.y);
        const y2 = Math.max(d.y0, pt.y);
        h.view.showSelectionBox({ x1, y1, x2, y2 });
        const { ppb, rowH } = h.view;
        h.selection.clear();
        for (const id of d.base) h.selection.add(id);
        for (const n of h.notes()) {
          const top = h.view.rowTop(n.p);
          if (n.s * ppb < x2 && (n.s + n.d) * ppb > x1 && top < y2 && top + rowH > y1) h.selection.add(n.id);
        }
        h.drawSelection();
        return;
      }

      case "move": {
        const a = d.orig.find((o) => o.n === d.anchor)!;
        const to = a.s + pt.beat - d.start.beat;
        let ds = (h.snap() ? h.snapRound(to) : to) - a.s;
        let dp = pt.pitch - d.start.pitch;
        ds = Math.max(ds, -Math.min(...d.orig.map((o) => o.s)));
        dp = clamp(dp, LOW - Math.min(...d.orig.map((o) => o.p)), HIGH - Math.max(...d.orig.map((o) => o.p)));
        for (const o of d.orig) {
          if (o.n.s !== o.s + ds || o.n.p !== o.p + dp) d.moved = true;
          o.n.s = o.s + ds;
          o.n.p = o.p + dp;
          h.drawNote(o.n);
        }
        h.setPreview(d.anchor.p);
        h.updateExtent();
        return;
      }

      case "resize": {
        const a = d.orig.find((o) => o.n === d.anchor)!;
        const snap = h.snap();
        const end = snap ? h.snapRound(pt.beat) : pt.beat;
        const dd = end - (a.s + a.d);
        for (const o of d.orig) {
          const len = Math.max(snap ? Math.min(snap, o.d) : MIN_LEN, o.d + dd);
          if (len !== o.n.d) d.moved = true;
          o.n.d = len;
          h.drawNote(o.n);
        }
        h.updateExtent();
        return;
      }
    }
  }

  private up(e: PointerEvent): void {
    const h = this.host;
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    h.setPreview(0);
    switch (d.type) {
      case "tap": {
        h.checkpoint();
        const n = h.addNote(d.pt.pitch, h.snapFloor(d.pt.beat), h.lastLength);
        h.selectOnly([n]);
        h.changed();
        h.flashPreview(n.p);
        break;
      }
      case "move":
      case "resize":
        if (d.moved) {
          h.pushUndo(d.before);
          if (d.type === "resize") h.lastLength = d.anchor.d;
          h.changed();
        }
        break;
      case "erase":
        if (d.erased) h.changed();
        break;
      case "box":
        h.view.showSelectionBox(null);
        break;
    }
  }

  private cancel(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.type === "tap") {
      this.drag = null; // the finger scrolled instead
      return;
    }
    this.up(e); // keep what an interrupted edit did so far
  }
}

/** The piano-key column: press a row's key to hear it; slide for a glissando. */
export class KeyColumn {
  private pointers = new Map<number, number>();
  private readonly detach: (() => void)[];

  constructor(
    private readonly view: RollView,
    private readonly input: { down(m: number): void; up(m: number): void; unlockAudio(): void },
  ) {
    const keys = view.pkeys;
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      const old = this.pointers.get(e.pointerId)!;
      this.pointers.delete(e.pointerId);
      if (old) input.up(old);
    };
    this.detach = [
      listen(keys, "pointerdown", (e) => {
        e.preventDefault();
        input.unlockAudio();
        keys.setPointerCapture(e.pointerId);
        const m = view.keyAt(e.clientX, e.clientY);
        this.pointers.set(e.pointerId, m);
        if (m) input.down(m);
      }),
      listen(keys, "pointermove", (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        const m = view.keyAt(e.clientX, e.clientY);
        const old = this.pointers.get(e.pointerId)!;
        if (m === old) return;
        this.pointers.set(e.pointerId, m);
        if (old) input.up(old);
        if (m) input.down(m);
      }),
      listen(keys, "pointerup", end),
      listen(keys, "pointercancel", end),
      listen(keys, "lostpointercapture", end),
      listen(keys, "contextmenu", (e) => e.preventDefault()),
    ];
  }

  /** Let go of every key held here. */
  releaseAll(): void {
    const held = [...this.pointers.values()].filter(Boolean);
    this.pointers.clear();
    for (const m of held) this.input.up(m);
  }

  destroy(): void {
    for (const off of this.detach) off();
  }
}

/** The ruler: click or drag to move the start cursor (not while recording). */
export function attachRuler(
  view: RollView,
  opts: { seek(beat: number): void; snapRound(beat: number): number; recording(): boolean },
): () => void {
  const ruler = view.ruler;
  let pointer: number | null = null;
  const at = (e: PointerEvent) => opts.snapRound(view.rulerBeat(e.clientX));
  const release = (e: PointerEvent) => {
    if (e.pointerId === pointer) pointer = null;
  };
  const off = [
    listen(ruler, "pointerdown", (e) => {
      if (opts.recording()) return;
      e.preventDefault();
      pointer = e.pointerId;
      ruler.setPointerCapture(pointer);
      opts.seek(at(e));
    }),
    listen(ruler, "pointermove", (e) => {
      if (e.pointerId === pointer) opts.seek(at(e));
    }),
    listen(ruler, "pointerup", release),
    listen(ruler, "pointercancel", release),
  ];
  return () => off.forEach((f) => f());
}
