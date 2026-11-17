// An on-screen piano keyboard (mouse, multi-touch, glissando, computer keys).
// It only reports presses: onDown(midi) / onUp(midi). What sounds is decided by
// the mode using it (Piano: last key wins; Studio: resultant of all held notes).
import { isBlack, noteName } from "./notes.js";

// Computer keys by physical position (works on any layout); index = semitones above the first C
const KEYMAP = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH",
                "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon", "Quote"];
const MIN_OCTAVE = 1, MAX_OCTAVE = 6;

let layoutMap = null;         // real key labels for the user's keyboard layout, if the browser tells us
const all = new Set();
navigator.keyboard?.getLayoutMap?.().then((m) => { layoutMap = m; for (const k of all) k.build(); }).catch(() => {});

export class Keyboard {
  /**
   * el: the .keyboard element; wrap: its container (sets the width); range/octDown/octUp:
   * the octave label and buttons; onDown/onUp(midi): press callbacks.
   */
  constructor({ el, wrap, range, octDown, octUp, onDown, onUp, octave = 4 }) {
    Object.assign(this, { el, wrap, rangeEl: range, octDownEl: octDown, octUpEl: octUp, onDown, onUp, octave });
    this.whiteCount = 0;
    this.keyEls = new Map();      // midi -> key element
    this.pointerNotes = new Map(); // pointerId -> midi (0 = not over a key)
    this.keyNotes = new Map();     // KeyboardEvent.code -> midi
    this.sounding = new Set();
    this.teacher = new Set();      // what the live teacher is playing (shown to students)
    all.add(this);

    octDown.onclick = () => this.shift(-1);
    octUp.onclick = () => this.shift(1);
    new ResizeObserver(() => this.fit()).observe(wrap);

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const m = this.keyAt(e.clientX, e.clientY);
      this.pointerNotes.set(e.pointerId, m);
      if (m) this.onDown(m);
      this.render();
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.pointerNotes.has(e.pointerId)) return;
      const m = this.keyAt(e.clientX, e.clientY);
      const old = this.pointerNotes.get(e.pointerId);
      if (m === old) return;
      this.pointerNotes.set(e.pointerId, m);
      if (old) this.onUp(old);
      if (m) this.onDown(m);
      this.render();
    });
    // A finger lifted / mouse released: release the note that pointer was holding
    const end = (e) => {
      if (!this.pointerNotes.has(e.pointerId)) return;
      const old = this.pointerNotes.get(e.pointerId);
      this.pointerNotes.delete(e.pointerId);
      if (old) this.onUp(old);
      this.render();
    };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, end);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  baseMidi() { return 12 * (this.octave + 1); } // the leftmost key is C<octave>

  /** Pick how many white keys fit the width (wider keys on touch screens). */
  fit() {
    if (!this.wrap.clientWidth) return; // hidden
    const coarse = matchMedia("(pointer: coarse)").matches;
    const n = Math.max(7, Math.min(22, Math.floor(this.wrap.clientWidth / (coarse ? 44 : 52))));
    if (n !== this.whiteCount) { this.whiteCount = n; this.build(); }
  }

  /** Move the keyboard d octaves up/down. */
  shift(d) {
    const o = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, this.octave + d));
    if (o !== this.octave) { this.octave = o; this.build(); }
  }

  /** (Re)draw whiteCount white keys starting at C<octave>, plus the black keys between them. */
  build() {
    if (!this.whiteCount) return;
    this.releaseAll();
    this.el.innerHTML = "";
    this.keyEls.clear();
    const base = this.baseMidi(), n = this.whiteCount;
    const whites = [];
    for (let m = base; whites.length < n; m++) if (!isBlack(m)) whites.push(m);

    const label = (m) => {
      const code = KEYMAP[m - base];
      if (!code) return "";
      const k = layoutMap?.get(code) ?? { Semicolon: ";", Quote: "'" }[code] ?? code.slice(3);
      return `<span class="kbd">${k.toUpperCase()}</span>`;
    };

    whites.forEach((m, i) => {
      const w = document.createElement("div");
      w.className = "key white" + (m % 12 === 0 ? " c" : "");
      w.dataset.midi = m;
      w.innerHTML = `${label(m)}<b>${noteName(m)}</b>`;
      this.el.append(w);
      this.keyEls.set(m, w);
      if (i < whites.length - 1 && isBlack(m + 1)) {
        const b = document.createElement("div");
        b.className = "key black";
        b.dataset.midi = m + 1;
        b.style.left = `${((i + 1) / n) * 100}%`;
        b.style.width = `${58 / n}%`;
        b.innerHTML = label(m + 1);
        this.el.append(b);
        this.keyEls.set(m + 1, b);
      }
    });

    this.rangeEl.textContent = `${noteName(whites[0])}–${noteName(whites[whites.length - 1])}`;
    this.octDownEl.disabled = this.octave <= MIN_OCTAVE;
    this.octUpEl.disabled = this.octave >= MAX_OCTAVE;
    this.render();
  }

  /** MIDI note of the key under the screen point (x, y), or 0 if none. */
  keyAt(x, y) {
    const k = document.elementFromPoint(x, y)?.closest(".key");
    return k && this.el.contains(k) ? +k.dataset.midi : 0;
  }

  /** Highlight held keys ("down"), the notes that are sounding and the teacher's ("teacher"). */
  render() {
    const down = new Set([...this.pointerNotes.values(), ...this.keyNotes.values()]);
    for (const [m, k] of this.keyEls) {
      k.classList.toggle("down", down.has(m));
      k.classList.toggle("sounding", this.sounding.has(m));
      k.classList.toggle("teacher", this.teacher.has(m));
    }
  }

  setSounding(midis) {
    this.sounding = new Set(midis);
    this.render();
  }

  /** Show the notes the live teacher is playing (students' keyboards). */
  setTeacher(midis) {
    this.teacher = new Set(midis);
    this.render();
  }

  /** Let go of every key (mouse, touch and computer keyboard). */
  releaseAll() {
    const held = [...this.pointerNotes.values(), ...this.keyNotes.values()].filter(Boolean);
    this.pointerNotes.clear();
    this.keyNotes.clear();
    for (const m of held) this.onUp(m);
    this.render();
  }

  /** Handle a keydown for the piano keys / Z X octave keys; true if it was one of them. */
  keyDown(e) {
    if (e.code === "KeyZ" || e.code === "KeyX") {
      if (!e.repeat) this.shift(e.code === "KeyZ" ? -1 : 1);
      return true;
    }
    const i = KEYMAP.indexOf(e.code);
    if (i < 0) return false;
    e.preventDefault();
    if (e.repeat || this.keyNotes.has(e.code)) return true;
    const m = this.baseMidi() + i;
    this.keyNotes.set(e.code, m);
    this.onDown(m);
    this.render();
    return true;
  }

  keyUp(e) {
    if (!this.keyNotes.has(e.code)) return;
    const m = this.keyNotes.get(e.code);
    this.keyNotes.delete(e.code);
    this.onUp(m);
    this.render();
  }
}
