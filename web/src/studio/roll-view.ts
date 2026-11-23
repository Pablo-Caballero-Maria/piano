/**
 * The piano roll's DOM: the ruler (bars), the piano-key column (Y axis: one row per note), the
 * grid with the notes, the playhead and the selection box. Positions are CSS calc()s of a few
 * custom properties (--ppb px per beat, --rowh px per row, --beats, --rows, --keyw), so zooming
 * doesn't touch each note. This class only draws; the engine decides what.
 *
 * The elements are styled with Tailwind classes, the ruler's and the grid's lines too (background
 * gradients sized from the custom properties above).
 * The engine marks states with plain classes, which the elements' [&.state]: variants style:
 * the roll is .fine when zoomed in, the grid .erasing or .readonly, a note .sel, .rec or .on (playing),
 * a piano key .hover or .on.
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

const PX = {
  keyW: "w-[calc(var(--keyw)*1px)]",
  beatsW: "w-[calc(var(--beats)*var(--ppb)*1px)]",
  rowH: "h-[calc(var(--rowh)*1px)]",
};

const CLASSES = {
  inner: "relative w-[calc((var(--keyw)_+_var(--beats)*var(--ppb))*1px)]",
  rulerRow: "sticky top-0 z-4 flex h-6 border-b border-line bg-panel",
  corner: `sticky left-0 z-5 flex flex-none items-center justify-center border-r border-line bg-panel text-[11px] text-muted ${PX.keyW}`,
  /** A line per bar, and a short tick per beat along the bottom. */
  ruler: `relative flex-none cursor-pointer touch-none ${PX.beatsW} [background:linear-gradient(to_right,var(--color-roll-bar)_1px,transparent_1px)_0_0/calc(var(--ppb)*4px)_100%,linear-gradient(to_right,var(--color-roll-bar)_1px,transparent_1px)_0_100%/calc(var(--ppb)*1px)_7px_repeat-x]`,
  rulerLabel:
    "pointer-events-none absolute top-1 left-[calc(var(--bar)*var(--ppb)*4px_+_4px)] text-[11px] text-muted tabular-nums",
  cursorMark:
    "pointer-events-none absolute top-0 -left-1.5 z-1 size-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-warn",
  rulerHead: "pointer-events-none absolute inset-y-0 -left-px w-0.5 bg-accent",
  pkeys: `sticky left-0 z-3 flex-none cursor-pointer touch-none ${PX.keyW}`,
  pianoKey: `pk flex items-center justify-between gap-0.5 overflow-hidden border-b border-black/30 px-[5px] text-[10px] leading-none [&.hover]:shadow-[inset_4px_0_0_var(--color-warn)] ${PX.rowH}`,
  whiteKey: "bg-[#e7e6e1] text-[#6b6b6b] [&.on]:bg-[#8fd4b0]",
  blackKey: "bg-[#24262c] text-[#8f949c] [&.on]:bg-[#2a7b54] [&.on]:text-fg",
  /**
   * Its background, from the top layer down: bar lines, beat lines, 1/16 lines (--step-line: only when
   * zoomed in, .fine), a line under every octave, a line under every row, and one octave of row shades
   * from the top (B A# A G# G F# F E D# D C# C, the black keys darker).
   */
  grid: `roll-grid relative h-[calc(var(--rows)*var(--rowh)*1px)] flex-none cursor-cell touch-pan-x touch-pan-y [--step-line:transparent] [.fine_&]:[--step-line:var(--color-roll-step)] [&.erasing:not(.readonly)]:cursor-crosshair [&.readonly]:cursor-default ${PX.beatsW} [background:linear-gradient(to_right,var(--color-roll-bar)_1px,transparent_1px)_0_0/calc(var(--ppb)*4px)_100%,linear-gradient(to_right,var(--color-roll-beat)_1px,transparent_1px)_0_0/calc(var(--ppb)*1px)_100%,linear-gradient(to_right,var(--step-line)_1px,transparent_1px)_0_0/calc(var(--ppb)*0.25px)_100%,linear-gradient(to_bottom,transparent_calc(100%_-_1px),var(--color-roll-bar)_0)_0_0/100%_calc(var(--rowh)*12px),linear-gradient(to_bottom,transparent_calc(100%_-_1px),var(--color-roll-rowline)_0)_0_0/100%_calc(var(--rowh)*1px),linear-gradient(to_bottom,var(--color-roll-row)_0_8.3333%,var(--color-roll-row-dark)_8.3333%_16.6667%,var(--color-roll-row)_16.6667%_25%,var(--color-roll-row-dark)_25%_33.3333%,var(--color-roll-row)_33.3333%_41.6667%,var(--color-roll-row-dark)_41.6667%_50%,var(--color-roll-row)_50%_66.6667%,var(--color-roll-row-dark)_66.6667%_75%,var(--color-roll-row)_75%_83.3333%,var(--color-roll-row-dark)_83.3333%_91.6667%,var(--color-roll-row)_91.6667%_100%)_0_0/100%_calc(var(--rowh)*12px)]`,
  notes: "absolute inset-0",
  note: `note absolute box-border cursor-grab touch-none overflow-hidden rounded-[3px] border border-[#276b4b] bg-[#5fd39a] pl-[3px] text-[10px] leading-[calc(var(--rowh)*1px_-_2px)] font-semibold whitespace-nowrap text-[#0b2a1b] top-[calc(var(--r)*var(--rowh)*1px)] left-[calc(var(--s)*var(--ppb)*1px)] w-[max(4px,calc(var(--d)*var(--ppb)*1px))] ${PX.rowH} [.erasing_&]:cursor-crosshair [&.on]:z-1 [&.on]:shadow-[0_0_0_1px_#fff,0_0_10px_rgba(143,243,193,0.8)] [&.on]:brightness-120 [&.rec]:border-[#9c2f2f] [&.rec]:bg-[#ff7b7b] [&.sel]:text-[#2a1800] [&.sel:not(.rec)]:border-[#9a5f0c] [&.sel:not(.rec)]:bg-[#ffb454]`,
  /** The note's right edge: drag to resize (wider for fingers). */
  noteHandle:
    "h absolute inset-y-0 right-0 w-[min(8px,35%)] cursor-ew-resize pointer-coarse:w-[min(16px,45%)]",
  playhead:
    "pointer-events-none absolute inset-y-0 -left-px z-2 w-0.5 bg-accent shadow-[0_0_6px_var(--color-accent)]",
  selBox: "pointer-events-none absolute z-3 border border-dashed border-[#ffb454] bg-[rgba(255,180,84,0.12)]",
};

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
    const inner = div(CLASSES.inner, roll);
    const rulerRow = div(CLASSES.rulerRow, inner);
    div(CLASSES.corner, rulerRow).textContent = "Bar";
    this.ruler = div(CLASSES.ruler, rulerRow);
    this.rulerLabels = div("", this.ruler);
    this.cursorMark = div(CLASSES.cursorMark, this.ruler);
    this.rulerHead = div(CLASSES.rulerHead, this.ruler);
    const body = div("flex", inner);
    this.pkeys = div(CLASSES.pkeys, body);
    this.grid = div(CLASSES.grid, body);
    this.notesLayer = div(CLASSES.notes, this.grid);
    this.playhead = div(CLASSES.playhead, this.grid);
    this.selBox = div(CLASSES.selBox, this.grid);
    this.selBox.hidden = true;

    for (let m = HIGH; m >= LOW; m--) {
      const k = div(`${CLASSES.pianoKey} ${isBlack(m) ? CLASSES.blackKey : CLASSES.whiteKey}`, this.pkeys);
      k.dataset.midi = String(m);
      const name = document.createElement("b");
      name.className = m % 12 === 0 ? "font-[750] text-[#111]" : "font-semibold";
      name.textContent = noteName(m);
      const freq = document.createElement("span");
      freq.className = "text-[9px] tabular-nums opacity-70";
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
      span.className = CLASSES.rulerLabel;
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
      el = div(CLASSES.note, this.notesLayer);
      el.dataset.id = String(n.id);
      const name = document.createElement("span");
      name.className = "pointer-events-none";
      el.append(name);
      const handle = document.createElement("i");
      handle.className = CLASSES.noteHandle;
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
