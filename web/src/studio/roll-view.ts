/**
 * The piano roll's DOM: the ruler (bars), the piano-key column (Y axis: one row per note), the
 * grid with the notes, the playhead and the selection box. Positions are CSS calc()s of a few
 * custom properties (--ppb px per beat, --rowh px per row, --beats, --rows, --keyw), so zooming
 * doesn't touch each note. This class only draws; the engine decides what.
 */
import { exactFreq, freqOf, isBlack, noteName } from "@/lib/notes";
import { BEATS_PER_BAR, HIGH, KEY_W, LOW, MAX_PPB, MIN_BARS, MIN_PPB } from "./constants";
import type { EditorNote } from "./types";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Where a pointer is on the grid: beat, MIDI note, and px from the grid's top-left corner. */
export interface GridPoint {
  beat: number;
  pitch: number;
  x: number;
  y: number;
}

export interface NoteLook {
  selected: boolean;
  playing: boolean;
}

function div(className: string, parent?: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  parent?.append(el);
  return el;
}

export class RollView {
  readonly grid: HTMLDivElement;
  readonly pkeys: HTMLDivElement;
  readonly ruler: HTMLDivElement;
  private readonly notesLayer: HTMLDivElement;
  private readonly rulerLabels: HTMLDivElement;
  private readonly playhead: HTMLDivElement;
  private readonly rulerHead: HTMLDivElement;
  private readonly cursorMark: HTMLDivElement;
  private readonly selBox: HTMLDivElement;
  private readonly noteEls = new Map<number, HTMLDivElement>();
  private lit = new Set<number>();
  private hoverPitch = 0;
  /** px per beat (horizontal zoom). */
  ppb = 64;
  /** px per row. */
  rowH = 16;
  totalBeats = 0;

  constructor(readonly roll: HTMLElement) {
    roll.replaceChildren();
    const inner = div("roll-inner", roll);
    const rulerRow = div("ruler-row", inner);
    div("corner", rulerRow).textContent = "Bar";
    this.ruler = div("ruler", rulerRow);
    this.rulerLabels = div("ruler-labels", this.ruler);
    this.cursorMark = div("cursor-mark", this.ruler);
    this.rulerHead = div("ruler-head", this.ruler);
    const body = div("body-row", inner);
    this.pkeys = div("pkeys", body);
    this.grid = div("grid", body);
    this.notesLayer = div("notes", this.grid);
    this.playhead = div("playhead", this.grid);
    this.selBox = div("selbox", this.grid);
    this.selBox.hidden = true;

    for (let m = HIGH; m >= LOW; m--) {
      const k = div(`pk ${isBlack(m) ? "b" : "w"}${m % 12 === 0 ? " c" : ""}`, this.pkeys);
      k.dataset.midi = String(m);
      const name = document.createElement("b");
      name.textContent = noteName(m);
      const freq = document.createElement("span");
      freq.textContent = String(freqOf(m));
      k.append(name, freq);
      k.title = `${noteName(m)} = ${exactFreq(m).toFixed(1)} Hz`;
    }

    roll.style.setProperty("--keyw", String(KEY_W));
    roll.style.setProperty("--rows", String(HIGH - LOW + 1));
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.rowH = coarse ? 20 : 16;
    roll.style.setProperty("--rowh", String(this.rowH));
    this.setZoom(coarse ? 48 : 64);
  }

  destroy(): void {
    this.roll.replaceChildren();
    this.noteEls.clear();
  }

  /** Make the timeline long enough to show up to beat `end` (plus 4 empty bars). */
  setExtent(end: number, force = false): void {
    const bars = Math.max(MIN_BARS, Math.ceil(end / BEATS_PER_BAR) + 4);
    if (!force && bars * BEATS_PER_BAR === this.totalBeats) return;
    this.totalBeats = bars * BEATS_PER_BAR;
    this.roll.style.setProperty("--beats", String(this.totalBeats));
    const labels = [];
    for (let b = 0; b < bars; b++) {
      const span = document.createElement("span");
      span.style.setProperty("--bar", String(b));
      span.textContent = String(b + 1);
      labels.push(span);
    }
    this.rulerLabels.replaceChildren(...labels);
  }

  /** Horizontal zoom (px per beat), keeping the beat under screen x (default: the middle) in place. */
  setZoom(ppb: number, anchorX?: number): void {
    ppb = clamp(ppb, MIN_PPB, MAX_PPB);
    const r = this.roll.getBoundingClientRect();
    const viewX = (anchorX ?? r.left + KEY_W + (this.roll.clientWidth - KEY_W) / 2) - r.left - KEY_W;
    const beat = (this.roll.scrollLeft + viewX) / this.ppb;
    this.ppb = ppb;
    this.roll.style.setProperty("--ppb", String(ppb));
    this.roll.classList.toggle("fine", ppb * 0.25 >= 9); // show the 1/16 lines when there's room
    this.roll.scrollLeft = beat * ppb - viewX;
  }

  // ---- Notes --------------------------------------------------------------------------------

  drawNote(n: EditorNote, look: NoteLook): void {
    let el = this.noteEls.get(n.id);
    if (!el) {
      el = div("note", this.notesLayer);
      el.dataset.id = String(n.id);
      el.append(document.createElement("span"));
      const handle = document.createElement("i");
      handle.className = "h";
      el.append(handle);
      this.noteEls.set(n.id, el);
    }
    el.style.setProperty("--s", String(n.s));
    el.style.setProperty("--d", String(n.d));
    el.style.setProperty("--r", String(HIGH - n.p));
    el.firstChild!.textContent = noteName(n.p);
    el.classList.toggle("sel", look.selected);
    el.classList.toggle("rec", !!n.rec);
    el.classList.toggle("on", look.playing);
  }

  /** Draw every note and remove the elements of notes that are gone. */
  drawNotes(notes: readonly EditorNote[], look: (n: EditorNote) => NoteLook): void {
    const ids = new Set<number>();
    for (const n of notes) {
      this.drawNote(n, look(n));
      ids.add(n.id);
    }
    for (const [id, el] of this.noteEls) {
      if (!ids.has(id)) {
        el.remove();
        this.noteEls.delete(id);
      }
    }
  }

  setNoteClass(id: number, className: "sel" | "on", on: boolean): void {
    this.noteEls.get(id)?.classList.toggle(className, on);
  }

  /** The id of the note element at (or containing) target, if it's one of ours. */
  noteIdOf(target: EventTarget | null): number | null {
    const el = (target as Element | null)?.closest?.<HTMLElement>(".note");
    return el && this.grid.contains(el) ? Number(el.dataset.id) : null;
  }

  noteIdAt(x: number, y: number): number | null {
    return this.noteIdOf(document.elementFromPoint(x, y));
  }

  // ---- Coordinates ------------------------------------------------------------------------

  gridPoint(e: { clientX: number; clientY: number }): GridPoint {
    const r = this.grid.getBoundingClientRect();
    return {
      beat: Math.max(0, (e.clientX - r.left) / this.ppb),
      pitch: clamp(HIGH - Math.floor((e.clientY - r.top) / this.rowH), LOW, HIGH),
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    };
  }

  /** The beat under screen x on the ruler. */
  rulerBeat(clientX: number): number {
    return Math.max(0, (clientX - this.ruler.getBoundingClientRect().left) / this.ppb);
  }

  /** The note of the piano-key row under a screen point, or 0. */
  keyAt(x: number, y: number): number {
    const k = document.elementFromPoint(x, y)?.closest<HTMLElement>(".pk");
    return k && this.pkeys.contains(k) ? Number(k.dataset.midi) : 0;
  }

  /** The top of a note's row, px from the grid's top. */
  rowTop = (pitch: number): number => (HIGH - pitch) * this.rowH;

  // ---- Highlights ---------------------------------------------------------------------------

  private keyEl = (m: number): Element | undefined => this.pkeys.children[HIGH - m];

  /** The row the mouse is over (marked on its key). */
  setHover(pitch: number): void {
    if (pitch === this.hoverPitch) return;
    this.keyEl(this.hoverPitch)?.classList.remove("hover");
    this.hoverPitch = pitch;
    this.keyEl(pitch)?.classList.add("hover");
  }

  /** Light the keys of the notes sounding now. */
  lightKeys(pitches: readonly number[]): void {
    const next = new Set(pitches);
    for (const m of this.lit) if (!next.has(m)) this.keyEl(m)?.classList.remove("on");
    for (const m of next) this.keyEl(m)?.classList.add("on");
    this.lit = next;
  }

  showSelectionBox(box: { x1: number; y1: number; x2: number; y2: number } | null): void {
    this.selBox.hidden = !box;
    if (!box) return;
    Object.assign(this.selBox.style, {
      left: `${box.x1}px`,
      top: `${box.y1}px`,
      width: `${box.x2 - box.x1}px`,
      height: `${box.y2 - box.y1}px`,
    });
  }

  setTool(erasing: boolean): void {
    this.grid.classList.toggle("erasing", erasing);
  }

  setReadOnly(readOnly: boolean): void {
    this.grid.classList.toggle("readonly", readOnly);
  }

  // ---- Playhead and scrolling ---------------------------------------------------------------

  /** The playhead at beat p, the start cursor at beat cursor. */
  drawPlayhead(p: number, cursor: number): void {
    const x = `translateX(${p * this.ppb}px)`;
    this.playhead.style.transform = x;
    this.rulerHead.style.transform = x;
    this.cursorMark.style.transform = `translateX(${cursor * this.ppb}px)`;
  }

  /** Keep the playhead in view while playing. */
  follow(p: number): void {
    const x = p * this.ppb;
    const view = this.roll.clientWidth - KEY_W;
    if (x > this.roll.scrollLeft + view - 24 || x < this.roll.scrollLeft) this.roll.scrollLeft = x - 24;
  }

  /** Scroll to the start, with rows around pitch `mid` in view; false if the roll is hidden. */
  scrollTo(mid: number): boolean {
    if (!this.roll.clientHeight) return false;
    this.roll.scrollTop = (HIGH - mid) * this.rowH - (this.roll.clientHeight - 24) / 2;
    this.roll.scrollLeft = 0;
    return true;
  }
}
