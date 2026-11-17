// Studio mode: a piano roll like FL Studio's. X = time (beats), Y = pitch (frequency).
// Draw notes with the mouse/finger, play them, record new ones live from the piano,
// and save melodies to the user's account, private or public. Where notes overlap, the
// buzzer plays their resultant frequency (see resultant() in notes.js).
// In a lesson, the teacher's piano roll is shared (studioState(), onStudioChange()) and
// students can follow it read-only (followTeacher()).
import { isBlack, noteName, freqOf, exactFreq, resultant } from "./notes.js";
import { output, unlockAudio, click as metronomeClick } from "./sound.js";
import { Keyboard } from "./keyboard.js";
import * as api from "./api.js";
import { toast, confirmDialog, openAuth, icon } from "./ui.js";

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const LOW = 24, HIGH = 119;    // rows: C1 (33 Hz) up to B8 (7902 Hz)
const BEATS_PER_BAR = 4;
const MIN_BARS = 16;
const KEY_W = 64;              // width of the piano-key column, px (also in app.css)
const GAP_SEC = 0.05;          // silence inserted when the same frequency is struck again
const MIN_LEN = 1 / 32;        // shortest note (beats) when snap is off
const MAX_UNDO = 200;
const DRAFT_KEY = "piano-studio-draft";
const DEFAULT_NAME = "Untitled melody";

// ---- State ---------------------------------------------------------------------
// melody.notes: {id, p: MIDI note, s: start (beats), d: duration (beats), rec?: being recorded}
let melody = { id: null, name: "", bpm: 120, notes: [], public: false, owner: null };
let dirty = false;             // changed since the last save/open
let uid = 1;                   // ids for notes on this page (not saved)
const sel = new Set();         // selected note ids
let snap = 0.25, lastLen = 1, tool = "draw";
let ppb = 64, rowH = 16;       // zoom: px per beat, px per row
let totalBeats = 0;
let active = false;            // studio is the visible mode
let undoStack = [], redoStack = [];

// Transport
let playing = false, recording = false, looping = false, metronome = false;
let cursor = 0;                // where Play starts (beats)
let anchorBeat = 0, anchorTime = 0;
let timer = 0, raf = 0, lastBeat = -1;
let segs = [], segsDirty = true;
let playPitches = [], playIds = new Set();

// Live input (studio keyboard, key column, computer keys) and editing preview
const live = new Map();        // midi -> how many inputs hold it
const recHeld = new Map();     // midi -> notes being recorded for it
let recUndo = null, recTook = false;
let previewP = 0, previewToken = 0;

// DOM
let roll, grid, notesLayer, pkeys, rulerLabels, playheadEl, rulerHead, cursorEl, selBox, kb;
const noteEls = new Map();

// Lessons: who listens to changes (class.js), and the teacher's roll this page follows
const studioListeners = new Set();
let following = null;      // {teacher state…} while following the teacher's piano roll
let ownWork = null;        // my melody and editor state, put back when I stop following
let listScope = "mine";

function notify(kind) {
  for (const fn of studioListeners) fn(kind);
}

// ---- Helpers -----------------------------------------------------------------------
const noteById = (id) => melody.notes.find((n) => n.id === id);
const plainNotes = () => melody.notes.filter((n) => !n.rec).map(({ p, s, d }) => ({ p, s, d }));
const lengthBeats = () => melody.notes.reduce((m, n) => (n.rec ? m : Math.max(m, n.s + n.d)), 0);
const snapRound = (b) => (snap ? Math.round(b / snap) * snap : b);
const snapFloor = (b) => (snap ? Math.floor(b / snap + 1e-9) * snap : b);
const beatsToSec = (b) => (b * 60) / melody.bpm;

/** "1:05.3" for a time in seconds. */
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// ---- Building the piano roll -----------------------------------------------------
function buildRoll() {
  roll = $("roll");
  roll.innerHTML = `
    <div class="roll-inner">
      <div class="ruler-row">
        <div class="corner">Bar</div>
        <div class="ruler"><div class="ruler-labels"></div><div class="cursor-mark"></div><div class="ruler-head"></div></div>
      </div>
      <div class="body-row">
        <div class="pkeys"></div>
        <div class="grid"><div class="notes"></div><div class="playhead"></div><div class="selbox" hidden></div></div>
      </div>
    </div>`;
  grid = roll.querySelector(".grid");
  notesLayer = roll.querySelector(".notes");
  pkeys = roll.querySelector(".pkeys");
  rulerLabels = roll.querySelector(".ruler-labels");
  playheadEl = roll.querySelector(".playhead");
  rulerHead = roll.querySelector(".ruler-head");
  cursorEl = roll.querySelector(".cursor-mark");
  selBox = roll.querySelector(".selbox");

  // Y axis: one row per note, labelled with its name and frequency
  for (let m = HIGH; m >= LOW; m--) {
    const k = document.createElement("div");
    k.className = "pk " + (isBlack(m) ? "b" : "w") + (m % 12 === 0 ? " c" : "");
    k.dataset.midi = m;
    k.innerHTML = `<b>${noteName(m)}</b><span>${freqOf(m)}</span>`;
    k.title = `${noteName(m)} = ${exactFreq(m).toFixed(1)} Hz`;
    pkeys.append(k);
  }

  roll.style.setProperty("--keyw", KEY_W);
  roll.style.setProperty("--rows", HIGH - LOW + 1);
  const coarse = matchMedia("(pointer: coarse)").matches;
  rowH = coarse ? 20 : 16;
  roll.style.setProperty("--rowh", rowH);
  setZoom(coarse ? 48 : 64);
  updateExtent(true);
}

/** Make the timeline long enough for the melody (plus 4 empty bars) and the playhead. */
function updateExtent(force = false, upTo = 0) {
  const end = Math.max(lengthBeats(), upTo, ...melody.notes.filter((n) => n.rec).map((n) => n.s + n.d));
  const bars = Math.max(MIN_BARS, Math.ceil(end / BEATS_PER_BAR) + 4);
  if (!force && bars * BEATS_PER_BAR === totalBeats) return;
  totalBeats = bars * BEATS_PER_BAR;
  roll.style.setProperty("--beats", totalBeats);
  let html = "";
  for (let b = 0; b < bars; b++) html += `<span style="--bar:${b}">${b + 1}</span>`;
  rulerLabels.innerHTML = html;
}

/** Horizontal zoom (px per beat), keeping the beat under screen x (default: the middle) in place. */
function setZoom(v, anchorX) {
  v = clamp(v, 12, 320);
  const r = roll.getBoundingClientRect();
  const viewX = (anchorX ?? r.left + KEY_W + (roll.clientWidth - KEY_W) / 2) - r.left - KEY_W;
  const beat = (roll.scrollLeft + viewX) / ppb;
  ppb = v;
  roll.style.setProperty("--ppb", ppb);
  roll.classList.toggle("fine", ppb * 0.25 >= 9); // show the 1/16 lines when there's room
  roll.scrollLeft = beat * ppb - viewX;
  drawPlayhead();
}

// ---- Drawing notes -----------------------------------------------------------------
function drawNote(n) {
  let el = noteEls.get(n.id);
  if (!el) {
    el = document.createElement("div");
    el.className = "note";
    el.dataset.id = n.id;
    el.innerHTML = `<span></span><i class="h"></i>`;
    notesLayer.append(el);
    noteEls.set(n.id, el);
  }
  el.style.setProperty("--s", n.s);
  el.style.setProperty("--d", n.d);
  el.style.setProperty("--r", HIGH - n.p);
  el.firstChild.textContent = noteName(n.p);
  el.classList.toggle("sel", sel.has(n.id));
  el.classList.toggle("rec", !!n.rec);
  el.classList.toggle("on", playIds.has(n.id));
}

/** Sync every note element with melody.notes (adds, updates, removes). */
function drawNotes() {
  const ids = new Set();
  for (const n of melody.notes) { drawNote(n); ids.add(n.id); }
  for (const [id, el] of noteEls) if (!ids.has(id)) { el.remove(); noteEls.delete(id); }
  updateExtent();
}

function drawSelection() {
  for (const n of melody.notes) noteEls.get(n.id)?.classList.toggle("sel", sel.has(n.id));
}

function selectOnly(notes) {
  sel.clear();
  for (const n of notes) sel.add(n.id);
  drawSelection();
}

// ---- Undo / changes ------------------------------------------------------------------
const snapshot = () => JSON.stringify({ bpm: melody.bpm, notes: plainNotes() });

/** Remember a state (taken before a change) so Undo can go back to it. */
function pushUndo(state) {
  undoStack.push(state);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  renderUndo();
}
const checkpoint = () => pushUndo(snapshot());

function restore(state) {
  const o = JSON.parse(state);
  melody.bpm = o.bpm;
  melody.notes = o.notes.map((n) => ({ ...n, id: uid++ }));
  sel.clear();
  $("sBpm").value = melody.bpm;
  drawNotes();
  changed();
}

function undo() {
  if (!undoStack.length || recording) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  renderUndo();
}

function redo() {
  if (!redoStack.length || recording) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  renderUndo();
}

function renderUndo() {
  $("sUndo").disabled = !undoStack.length;
  $("sRedo").disabled = !redoStack.length;
}

/** Call after any edit to the melody. */
function changed() {
  dirty = true;
  segsDirty = true;
  updateExtent();
  renderSaveState();
  scheduleDraft();
  notify("edit");
}

function addNote(p, s, d) {
  const n = { id: uid++, p, s: Math.max(0, s), d };
  melody.notes.push(n);
  drawNote(n);
  return n;
}

function removeNotes(list) {
  const ids = new Set(list.map((n) => n.id));
  if (!ids.size) return;
  melody.notes = melody.notes.filter((n) => !ids.has(n.id));
  for (const id of ids) sel.delete(id);
  drawNotes();
}

function deleteSelected() {
  if (!sel.size) return;
  checkpoint();
  removeNotes(melody.notes.filter((n) => sel.has(n.id)));
  changed();
}

/** Move the selected notes by ds beats and dp semitones (arrow keys). */
function nudge(ds, dp) {
  const list = melody.notes.filter((n) => sel.has(n.id));
  if (!list.length) return;
  const minS = Math.min(...list.map((n) => n.s));
  const minP = Math.min(...list.map((n) => n.p)), maxP = Math.max(...list.map((n) => n.p));
  ds = Math.max(ds, -minS);
  dp = clamp(dp, LOW - minP, HIGH - maxP);
  if (!ds && !dp) return;
  checkpoint();
  for (const n of list) { n.s += ds; n.p += dp; drawNote(n); }
  changed();
  if (dp && list.length === 1) flashPreview(list[0].p);
}

// ---- Mouse / touch editing on the grid --------------------------------------------------
let drag = null;
let hoverP = 0;

/** Beat and MIDI note under a pointer event. */
function gridPoint(e) {
  const r = grid.getBoundingClientRect();
  return {
    beat: Math.max(0, (e.clientX - r.left) / ppb),
    pitch: clamp(HIGH - Math.floor((e.clientY - r.top) / rowH), LOW, HIGH),
    x: e.clientX - r.left,
    y: e.clientY - r.top,
  };
}

const pkeyEl = (m) => pkeys.children[HIGH - m];

function setHover(p) {
  if (p === hoverP) return;
  pkeyEl(hoverP)?.classList.remove("hover");
  hoverP = p;
  pkeyEl(p)?.classList.add("hover");
}

function eraseAt(n) {
  if (!n) return;
  if (!drag.erased) { drag.erased = true; pushUndo(drag.before); }
  removeNotes([n]);
}

function onGridDown(e) {
  if (following) return; // the teacher's roll is read-only
  if (drag || e.button === 1) return; // one gesture at a time; middle button = browser's own
  unlockAudio();
  const el = e.target.closest(".note");
  const n = el && noteById(+el.dataset.id);
  const pt = gridPoint(e);
  const touch = e.pointerType !== "mouse";
  const mod = e.shiftKey || e.ctrlKey || e.metaKey;

  // Erase tool, or the right mouse button (like FL Studio): delete what you touch
  if (tool === "erase" || e.button === 2) {
    if (!n && touch) return; // a finger on empty space scrolls
    e.preventDefault();
    grid.setPointerCapture(e.pointerId);
    drag = { type: "erase", id: e.pointerId, before: snapshot(), erased: false };
    eraseAt(n);
    return;
  }

  if (n) {
    e.preventDefault();
    if (mod) {
      // Shift/Ctrl-click toggles the note in the selection
      sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id);
      drawSelection();
      if (!sel.has(n.id)) return;
    } else if (!sel.has(n.id)) {
      selectOnly([n]);
    }
    grid.setPointerCapture(e.pointerId);
    const resize = e.target.classList.contains("h");
    if (!resize) lastLen = n.d; // new notes copy the length of the last one touched
    const group = melody.notes.filter((x) => sel.has(x.id));
    drag = { type: resize ? "resize" : "move", id: e.pointerId, start: pt, anchor: n,
             orig: group.map((x) => ({ n: x, s: x.s, p: x.p, d: x.d })), before: snapshot(), moved: false };
    setPreview(n.p);
    return;
  }

  // Empty space
  if (!touch && mod) {
    // Shift/Ctrl-drag: box selection
    e.preventDefault();
    grid.setPointerCapture(e.pointerId);
    drag = { type: "box", id: e.pointerId, x0: pt.x, y0: pt.y, base: new Set(e.shiftKey ? sel : []) };
    return;
  }
  if (touch) {
    // A tap adds a note on pointerup; a drag scrolls the roll instead (the browser cancels us)
    drag = { type: "tap", id: e.pointerId, x: e.clientX, y: e.clientY, pt };
    return;
  }
  // Mouse click: add a note there and keep dragging it
  e.preventDefault();
  grid.setPointerCapture(e.pointerId);
  const before = snapshot();
  const created = addNote(pt.pitch, snapFloor(pt.beat), lastLen);
  selectOnly([created]);
  drag = { type: "move", id: e.pointerId, start: pt, anchor: created,
           orig: [{ n: created, s: created.s, p: created.p, d: created.d }], before, moved: true };
  setPreview(created.p);
  updateExtent();
}

function onGridMove(e) {
  if (!drag) {
    if (e.pointerType === "mouse") setHover(gridPoint(e).pitch);
    return;
  }
  if (e.pointerId !== drag.id) return;
  const pt = gridPoint(e);

  switch (drag.type) {
    case "tap":
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) drag = null;
      return;

    case "erase": {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".note");
      if (el && grid.contains(el)) eraseAt(noteById(+el.dataset.id));
      return;
    }

    case "box": {
      const x1 = Math.min(drag.x0, pt.x), x2 = Math.max(drag.x0, pt.x);
      const y1 = Math.min(drag.y0, pt.y), y2 = Math.max(drag.y0, pt.y);
      Object.assign(selBox.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
      selBox.hidden = false;
      sel.clear();
      for (const id of drag.base) sel.add(id);
      for (const n of melody.notes) {
        const top = (HIGH - n.p) * rowH;
        if (n.s * ppb < x2 && (n.s + n.d) * ppb > x1 && top < y2 && top + rowH > y1) sel.add(n.id);
      }
      drawSelection();
      return;
    }

    case "move": {
      const a = drag.orig.find((o) => o.n === drag.anchor);
      let ds = (snap ? snapRound(a.s + pt.beat - drag.start.beat) : a.s + pt.beat - drag.start.beat) - a.s;
      let dp = pt.pitch - drag.start.pitch;
      ds = Math.max(ds, -Math.min(...drag.orig.map((o) => o.s)));
      dp = clamp(dp, LOW - Math.min(...drag.orig.map((o) => o.p)), HIGH - Math.max(...drag.orig.map((o) => o.p)));
      for (const o of drag.orig) {
        if (o.n.s !== o.s + ds || o.n.p !== o.p + dp) drag.moved = true;
        o.n.s = o.s + ds;
        o.n.p = o.p + dp;
        drawNote(o.n);
      }
      setPreview(drag.anchor.p);
      updateExtent();
      return;
    }

    case "resize": {
      const a = drag.orig.find((o) => o.n === drag.anchor);
      const end = snap ? snapRound(pt.beat) : pt.beat;
      const dd = end - (a.s + a.d);
      for (const o of drag.orig) {
        const d = Math.max(snap ? Math.min(snap, o.d) : MIN_LEN, o.d + dd);
        if (d !== o.n.d) drag.moved = true;
        o.n.d = d;
        drawNote(o.n);
      }
      updateExtent();
      return;
    }
  }
}

function onGridUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  setPreview(0);
  switch (d.type) {
    case "tap": {
      checkpoint();
      const n = addNote(d.pt.pitch, snapFloor(d.pt.beat), lastLen);
      selectOnly([n]);
      changed();
      flashPreview(n.p);
      break;
    }
    case "move":
    case "resize":
      if (d.moved) {
        pushUndo(d.before);
        if (d.type === "resize") lastLen = d.anchor.d;
        changed();
      }
      break;
    case "erase":
      if (d.erased) changed();
      break;
    case "box":
      selBox.hidden = true;
      break;
  }
}

function onGridCancel(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.type === "tap") { drag = null; return; } // the finger scrolled instead
  onGridUp(e); // keep what an interrupted edit did so far
}

// ---- Piano-key column (click a row's key to hear it; slide for glissando) ---------
const colPointers = new Map();

function keyColAt(e) {
  const k = document.elementFromPoint(e.clientX, e.clientY)?.closest(".pk");
  return k && pkeys.contains(k) ? +k.dataset.midi : 0;
}

function initKeyColumn() {
  pkeys.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    unlockAudio();
    pkeys.setPointerCapture(e.pointerId);
    const m = keyColAt(e);
    colPointers.set(e.pointerId, m);
    if (m) liveDown(m);
  });
  pkeys.addEventListener("pointermove", (e) => {
    if (!colPointers.has(e.pointerId)) return;
    const m = keyColAt(e), old = colPointers.get(e.pointerId);
    if (m === old) return;
    colPointers.set(e.pointerId, m);
    if (old) liveUp(old);
    if (m) liveDown(m);
  });
  const end = (e) => {
    if (!colPointers.has(e.pointerId)) return;
    const old = colPointers.get(e.pointerId);
    colPointers.delete(e.pointerId);
    if (old) liveUp(old);
  };
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pkeys.addEventListener(t, end);
  pkeys.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---- What sounds ------------------------------------------------------------------------
let lastMixKey = "";

/**
 * Combine everything that should sound right now (playback, live keys, the note being
 * edited) into one frequency for the buzzer: the resultant of all those notes.
 */
function mix() {
  if (!active) return;
  const pitches = [...new Set([...playPitches, ...live.keys(), ...(previewP ? [previewP] : [])])].sort((a, b) => a - b);
  const f = resultant(pitches);
  output(f, pitches);
  const key = pitches.join(",");
  if (key === lastMixKey) return;
  const before = new Set(lastMixKey ? lastMixKey.split(",").map(Number) : []);
  lastMixKey = key;
  kb.setSounding(pitches);
  for (const m of before) pkeyEl(m)?.classList.remove("on");
  for (const m of pitches) pkeyEl(m)?.classList.add("on");
  const names = pitches.map(noteName);
  $("sNow").innerHTML = !pitches.length ? "–"
    : pitches.length === 1 ? `${names[0]}<small>${f} Hz</small>`
    : `${names.length > 4 ? names.slice(0, 4).join("+") + "…" : names.join("+")}<small>→ ${f} Hz</small>`;
}

function setPreview(p) {
  previewToken++;
  if (p === previewP) return;
  previewP = p;
  mix();
}

/** Play note p briefly (after adding or transposing a note without a held pointer). */
function flashPreview(p) {
  setPreview(p);
  const t = previewToken;
  setTimeout(() => { if (t === previewToken) setPreview(0); }, 180);
}

function liveDown(m) {
  unlockAudio();
  live.set(m, (live.get(m) || 0) + 1);
  if (recording && playing && m >= LOW && m <= HIGH) {
    const n = { id: uid++, p: m, s: pos(), d: 1e-3, rec: true };
    melody.notes.push(n);
    if (!recHeld.has(m)) recHeld.set(m, []);
    recHeld.get(m).push(n);
    drawNote(n);
  }
  mix();
}

function liveUp(m) {
  const c = (live.get(m) || 0) - 1;
  if (c > 0) live.set(m, c); else live.delete(m);
  const n = recHeld.get(m)?.shift();
  if (n) finishRecordedNote(n, pos());
  mix();
}

// ---- Playback ---------------------------------------------------------------------------
/** Current playback position in beats (the start cursor when stopped). */
function pos() {
  return playing ? anchorBeat + ((performance.now() - anchorTime) * melody.bpm) / 60000 : cursor;
}

/** End of the loop: the melody rounded up to whole bars. */
const loopEnd = () => Math.max(BEATS_PER_BAR, Math.ceil(lengthBeats() / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR);

/**
 * Split the melody into segments where the same set of notes sounds:
 * [{t0, t1, f, pitches, ids}], covering 0 up to the end of the last note.
 * If a note starts while the frequency stays the same (e.g. the same note twice in a
 * row), a short silence goes before it so it can be heard as a new note.
 */
function buildSegments() {
  segsDirty = false;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const ev = [];
  for (const n of melody.notes) {
    if (n.rec) continue;
    ev.push([r6(n.s), 1, n], [r6(n.s + n.d), -1, n]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const raw = [];
  const sounding = new Set();
  let t = 0, attack = false;
  for (let k = 0; k < ev.length; ) {
    const time = ev[k][0];
    if (time > t) raw.push({ t0: t, t1: time, notes: [...sounding], attack });
    attack = false;
    for (; k < ev.length && ev[k][0] === time; k++) {
      if (ev[k][1] < 0) sounding.delete(ev[k][2]);
      else { sounding.add(ev[k][2]); attack = true; }
    }
    t = time;
  }

  const gap = (GAP_SEC * melody.bpm) / 60;
  segs = [];
  for (const s of raw) {
    s.pitches = [...new Set(s.notes.map((n) => n.p))];
    s.f = resultant(s.pitches);
    s.ids = new Set(s.notes.map((n) => n.id));
    const prev = segs.at(-1);
    if (prev && s.attack && s.f && s.f === prev.f) {
      const g = Math.min(gap, (prev.t1 - prev.t0) / 3);
      prev.t1 -= g;
      segs.push({ t0: prev.t1, t1: s.t0, f: 0, pitches: [], ids: prev.ids });
    }
    segs.push(s);
  }
}

/** The segment playing at beat p (binary search), or null past the end. */
function segAt(p) {
  let lo = 0, hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p < segs[mid].t0) hi = mid - 1;
    else if (p >= segs[mid].t1) lo = mid + 1;
    else return segs[mid];
  }
  return null;
}

function setPlayIds(ids) {
  for (const id of playIds) if (!ids.has(id)) noteEls.get(id)?.classList.remove("on");
  for (const id of ids) noteEls.get(id)?.classList.add("on");
  playIds = ids;
}

/** Scheduler: sets what sounds at the current position, then sleeps until the next change. */
function tick() {
  timer = 0;
  if (!playing) return;
  if (segsDirty) buildSegments();
  let p = pos();
  const end = recording ? Infinity : looping ? loopEnd() : lengthBeats();
  if (p >= end) {
    if (looping && end > 0) {
      anchorBeat = 0;
      anchorTime = performance.now();
      p = 0;
      lastBeat = -1;
    } else {
      stop();
      return;
    }
  }
  const seg = segAt(p);
  playPitches = seg ? seg.pitches : [];
  setPlayIds(seg ? seg.ids : new Set());
  if (metronome) {
    const b = Math.floor(p + 1e-6);
    if (b > lastBeat) { lastBeat = b; metronomeClick(b % BEATS_PER_BAR === 0); }
  }
  mix();
  const next = Math.min(seg ? seg.t1 : Infinity, metronome ? lastBeat + 1 : Infinity, end);
  const ms = ((next - p) * 60000) / melody.bpm;
  timer = setTimeout(tick, clamp(ms, 1, 30)); // wake at least every 30 ms to pick up edits
}

/** Animation: playhead, clock, auto-scroll, and notes growing while being recorded. */
function frame() {
  if (!playing) return;
  const p = pos();
  if (recording) {
    for (const list of recHeld.values()) for (const n of list) { n.d = Math.max(1e-3, p - n.s); drawNote(n); }
    updateExtent(false, p);
  }
  drawPlayhead(p);
  if (!drag) {
    const x = p * ppb, view = roll.clientWidth - KEY_W;
    if (x > roll.scrollLeft + view - 24 || x < roll.scrollLeft) roll.scrollLeft = x - 24;
  }
  raf = requestAnimationFrame(frame);
}

function drawPlayhead(p = pos()) {
  if (!playheadEl) return;
  const x = `translateX(${p * ppb}px)`;
  playheadEl.style.transform = x;
  rulerHead.style.transform = x;
  cursorEl.style.transform = `translateX(${cursor * ppb}px)`;
  const bar = Math.floor(p / BEATS_PER_BAR) + 1, beat = Math.floor(p % BEATS_PER_BAR) + 1;
  $("sClock").textContent = `${bar}.${beat}  ${fmtTime(beatsToSec(p))} / ${fmtTime(beatsToSec(lengthBeats()))}`;
}

function play() {
  if (playing) return;
  unlockAudio();
  if (!recording && !looping && cursor >= lengthBeats()) cursor = 0;
  playing = true;
  anchorBeat = cursor;
  anchorTime = performance.now();
  lastBeat = Math.ceil(cursor - 1e-6) - 1;
  segsDirty = true;
  renderTransport();
  tick();
  frame();
  notify("transport");
}

function stop() {
  if (!playing) return;
  if (recording) finishRecording();
  playing = recording = false;
  clearTimeout(timer);
  cancelAnimationFrame(raf);
  playPitches = [];
  setPlayIds(new Set());
  mix();
  drawPlayhead();
  renderTransport();
  notify("transport");
}

const togglePlay = () => (playing ? stop() : play());

/** Jump the playhead (and the start cursor) to beat b. */
function seek(b) {
  cursor = Math.max(0, b);
  if (playing && !recording) {
    anchorBeat = cursor;
    anchorTime = performance.now();
    lastBeat = Math.ceil(cursor - 1e-6) - 1;
    clearTimeout(timer);
    tick();
  }
  drawPlayhead();
  notify("transport");
}

// ---- Recording from the piano ----------------------------------------------------------
function toggleRecord() {
  if (recording) { stop(); return; }
  stop();
  unlockAudio();
  recUndo = snapshot();
  recTook = false;
  recording = true;
  play();
  toast("Recording: play the piano. Press ● or Stop to finish.");
}

/** A recorded key was released at beat `end`: snap it to the grid and keep it. */
function finishRecordedNote(n, end) {
  let s = snapRound(n.s), e = snapRound(end);
  const min = snap || MIN_LEN;
  if (e - s < min) e = s + min;
  n.s = Math.max(0, s);
  n.d = e - n.s;
  delete n.rec;
  if (!recTook) { pushUndo(recUndo); recTook = true; } // one Undo removes the whole take
  drawNote(n);
  changed();
}

function finishRecording() {
  const p = pos();
  for (const list of recHeld.values()) for (const n of list) finishRecordedNote(n, p);
  recHeld.clear();
}

function renderTransport() {
  $("sPlay").innerHTML = icon(playing ? "stop" : "play");
  $("sPlay").title = playing ? "Stop (Space)" : "Play (Space)";
  $("sPlay").setAttribute("aria-pressed", playing);
  $("sRec").setAttribute("aria-pressed", recording);
  $("sRec").classList.toggle("recording", recording);
  $("sLoop").setAttribute("aria-pressed", looping);
  $("sMetro").setAttribute("aria-pressed", metronome);
}

// ---- Ruler: click/drag to move the start cursor --------------------------------------
function initRuler() {
  const ruler = roll.querySelector(".ruler");
  let rid = null;
  const at = (e) => snapRound(Math.max(0, (e.clientX - ruler.getBoundingClientRect().left) / ppb));
  ruler.addEventListener("pointerdown", (e) => {
    if (recording) return;
    e.preventDefault();
    rid = e.pointerId;
    ruler.setPointerCapture(rid);
    seek(at(e));
  });
  ruler.addEventListener("pointermove", (e) => { if (e.pointerId === rid) seek(at(e)); });
  for (const t of ["pointerup", "pointercancel"]) ruler.addEventListener(t, (e) => { if (e.pointerId === rid) rid = null; });
}

// ---- Saving, opening, the melody list ------------------------------------------------
function renderSaveState() {
  const s = $("sSaveState");
  s.textContent = dirty ? "● Unsaved" : melody.id ? "✓ Saved" : "";
  s.dataset.state = dirty ? "dirty" : "saved";
  const pub = $("sPublic");
  const mine = !melody.owner || melody.owner === api.currentUser()?.username;
  pub.setAttribute("aria-pressed", !!melody.public);
  pub.innerHTML = icon(melody.public ? "globe" : "lock");
  pub.disabled = !mine;
  pub.title = !mine ? `Public melody by ${melody.owner}: everyone can edit it; only they can make it private`
    : melody.public ? "Public: everyone can see and edit it" : "Private: only you see it";
}

let draftTimer = 0;
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}

/** Keep the work in progress in this browser, so a reload doesn't lose it. */
function saveDraft() {
  try {
    if (following) return; // the teacher's roll isn't my work
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: melody.id, name: melody.name, bpm: melody.bpm, notes: plainNotes(), public: melody.public, owner: melody.owner, dirty,
    }));
  } catch {}
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && Array.isArray(d.notes)) {
      load({ id: d.id ?? null, name: d.name ?? "", bpm: d.bpm || 120, notes: d.notes, public: !!d.public, owner: d.owner ?? null });
      dirty = !!d.dirty;
      renderSaveState();
    }
  } catch {}
}

/** Put a melody {id, name, bpm, notes, public?, owner?} in the editor (clears undo history). */
function load(m) {
  stop();
  melody = {
    id: m.id, name: m.name, bpm: m.bpm, notes: m.notes.map(({ p, s, d }) => ({ id: uid++, p, s, d })),
    public: !!m.public, owner: m.owner ?? null,
  };
  sel.clear();
  undoStack = [];
  redoStack = [];
  dirty = false;
  cursor = 0;
  segsDirty = true;
  $("sName").value = melody.name;
  $("sBpm").value = melody.bpm;
  drawNotes();
  renderUndo();
  renderSaveState();
  drawPlayhead();
  scrollToNotes();
  saveDraft();
  notify("load");
}

/** Scroll so the melody's notes (or the middle of the keyboard) are in view. */
function scrollToNotes() {
  if (!roll.clientHeight) { scrollPending = true; return; }
  scrollPending = false;
  const ps = melody.notes.map((n) => n.p);
  const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 66;
  roll.scrollTop = (HIGH - mid) * rowH - (roll.clientHeight - 24) / 2;
  roll.scrollLeft = 0;
}
let scrollPending = true;

/** Ask before throwing away unsaved notes. */
async function okToDiscard() {
  if (!dirty || !melody.notes.length) return true;
  return confirmDialog(`"${melody.name || DEFAULT_NAME}" has unsaved changes. Discard them?`, "Discard");
}

async function newMelody() {
  if (!(await okToDiscard())) return;
  load({ id: null, name: "", bpm: melody.bpm, notes: [], public: false, owner: null });
}

async function save() {
  if (recording) stop();
  if (following) return;
  if (!api.currentUser() && !(await openAuth("Log in or create an account to save your melodies."))) return;
  const name = $("sName").value.trim() || DEFAULT_NAME;
  const payload = { name, bpm: melody.bpm, notes: plainNotes(), public: melody.public };
  const btn = $("sSave");
  btn.disabled = true;
  try {
    let m;
    if (melody.id) {
      try {
        m = await api.updateMelody(melody.id, payload);
      } catch (err) {
        if (err.status !== 404) throw err;
        m = await api.createMelody(payload); // deleted meanwhile, or another account's: save a new one
      }
    } else {
      m = await api.createMelody(payload);
    }
    melody.id = m.id;
    melody.name = m.name;
    melody.public = m.public;
    melody.owner = m.owner;
    $("sName").value = m.name;
    dirty = false;
    renderSaveState();
    saveDraft();
    toast(`Saved "${m.name}"`);
    if ($("listDlg").open) refreshList();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function openList() {
  if (!api.currentUser() && !(await openAuth("Log in to see your melodies and the public ones."))) return;
  $("listDlg").showModal();
  await refreshList();
}

function setListScope(scope) {
  listScope = scope;
  for (const b of document.querySelectorAll(".list-tabs [data-scope]")) b.setAttribute("aria-pressed", b.dataset.scope === scope);
  refreshList();
}

async function refreshList() {
  const ul = $("listItems");
  $("listEmpty").hidden = true;
  ul.innerHTML = `<li class="muted">Loading…</li>`;
  try {
    const list = await api.listMelodies(listScope);
    ul.innerHTML = "";
    $("listEmpty").textContent = listScope === "mine"
      ? "No melodies yet. Compose one in the Studio and press Save."
      : "No public melodies yet. Make one of yours public with the lock button next to Save.";
    $("listEmpty").hidden = list.length > 0;
    for (const m of list) ul.append(listRow(m));
    const cfg = await api.config();
    $("listFree").textContent = cfg.mode === "classroom" ? "Kept on the classroom board, and in the cloud when it syncs."
      : cfg.mode === "online" ? "Kept in the cloud." : "";
  } catch (err) {
    ul.innerHTML = "";
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = err.message;
    ul.append(li);
  }
}

function ago(date) {
  const s = (Date.now() - new Date(date)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

function listRow(m) {
  const li = document.createElement("li");
  if (m.id === melody.id) li.classList.add("current");
  const info = document.createElement("div");
  info.className = "info";
  const b = document.createElement("b");
  b.textContent = m.name;
  const small = document.createElement("small");
  const mine = m.owner === api.currentUser()?.username;
  const who = mine ? (m.public ? "public · " : "") : `by ${m.owner} · `;
  const edited = m.editedBy && m.editedBy !== m.owner ? ` (edited by ${m.editedBy})` : "";
  small.textContent = `${who}${m.noteCount} note${m.noteCount === 1 ? "" : "s"} · ${fmtTime((m.length * 60) / m.bpm)} · ${m.bpm} BPM · ${ago(m.updatedAt)}${edited}`;
  info.append(b, small);

  const btn = (label, title, fn, cls = "") => {
    const x = document.createElement("button");
    x.innerHTML = label; // only icon() markup or fixed text
    x.title = title;
    x.className = cls;
    x.onclick = fn;
    return x;
  };
  let delArmed = 0;
  const del = btn(icon("trash"), "Delete", async () => {
    if (!delArmed) {
      del.textContent = "Delete?";
      del.classList.add("armed");
      delArmed = setTimeout(() => { delArmed = 0; del.innerHTML = icon("trash"); del.classList.remove("armed"); }, 3000);
      return;
    }
    clearTimeout(delArmed);
    try {
      await api.deleteMelody(m.id);
      if (melody.id === m.id) { melody.id = null; dirty = true; renderSaveState(); saveDraft(); }
      toast(`Deleted "${m.name}"`);
      refreshList();
    } catch (err) { toast(err.message, "error"); }
  }, "danger");

  li.append(
    info,
    btn(icon("play"), "Open and play", () => openMelody(m.id, true)),
    btn("Open", "Open to edit", () => openMelody(m.id, false), "primary"),
    btn(icon("copy"), "Make my own copy", () => duplicate(m.id)),
  );
  if (mine) li.append(del); // only the owner can delete (the server checks too)
  return li;
}

async function openMelody(id, andPlay) {
  if (!(await okToDiscard())) return;
  try {
    const m = await api.getMelody(id);
    $("listDlg").close();
    load(m);
    if (andPlay) play();
  } catch (err) { toast(err.message, "error"); }
}

async function duplicate(id) {
  try {
    const m = await api.getMelody(id);
    const copy = await api.createMelody({ name: `${m.name} (copy)`.slice(0, 80), bpm: m.bpm, notes: m.notes, public: false });
    toast(`Saved "${copy.name}"`);
    refreshList();
  } catch (err) { toast(err.message, "error"); }
}

// ---- Toolbar ------------------------------------------------------------------------------
function setTool(t) {
  tool = t;
  $("sDraw").setAttribute("aria-pressed", t === "draw");
  $("sErase").setAttribute("aria-pressed", t === "erase");
  grid.classList.toggle("erasing", t === "erase");
}

function setBpm(v) {
  v = Math.round(clamp(Number(v) || 120, 20, 400));
  $("sBpm").value = v;
  if (v === melody.bpm) return;
  checkpoint();
  if (playing) { anchorBeat = pos(); anchorTime = performance.now(); }
  melody.bpm = v;
  changed();
  drawPlayhead();
}

function initToolbar() {
  const sn = $("sSnap");
  sn.value = String(snap);
  sn.onchange = () => (snap = Number(sn.value));
  $("sName").addEventListener("input", () => {
    melody.name = $("sName").value;
    dirty = true;
    renderSaveState();
    scheduleDraft();
  });
  $("sBpm").addEventListener("change", () => setBpm($("sBpm").value));
  $("sNew").onclick = newMelody;
  $("sOpen").onclick = openList;
  $("sSave").onclick = save;
  $("sPublic").onclick = () => {
    melody.public = !melody.public;
    dirty = true;
    renderSaveState();
    scheduleDraft();
    toast(melody.public ? "Public: everyone will see and can edit it (press Save)" : "Private: only you (press Save)");
  };
  for (const b of document.querySelectorAll(".list-tabs [data-scope]")) b.onclick = () => setListScope(b.dataset.scope);
  $("sFollowStop").onclick = () => followTeacher(null);
  $("sListClose").onclick = () => $("listDlg").close();
  $("sStart").onclick = () => seek(0);
  $("sPlay").onclick = togglePlay;
  $("sRec").onclick = toggleRecord;
  $("sLoop").onclick = () => { looping = !looping; renderTransport(); };
  $("sMetro").onclick = () => { metronome = !metronome; unlockAudio(); lastBeat = Math.floor(pos() + 1e-6); renderTransport(); };
  $("sDraw").onclick = () => setTool("draw");
  $("sErase").onclick = () => setTool("erase");
  $("sUndo").onclick = undo;
  $("sRedo").onclick = redo;
  $("sZoomOut").onclick = () => setZoom(ppb / 1.25);
  $("sZoomIn").onclick = () => setZoom(ppb * 1.25);
  let kbHidden = false;
  try { kbHidden = localStorage.getItem("piano-studio-kb") === "0"; } catch {}
  const renderKb = () => {
    $("studioKeys").hidden = kbHidden;
    $("sKb").setAttribute("aria-pressed", !kbHidden);
  };
  $("sKb").onclick = () => {
    kbHidden = !kbHidden;
    if (kbHidden) kb.releaseAll();
    try { localStorage.setItem("piano-studio-kb", kbHidden ? "0" : "1"); } catch {}
    renderKb();
  };
  renderKb();
  roll.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return; // Ctrl + wheel (or a trackpad pinch) zooms the time axis
    e.preventDefault();
    setZoom(ppb * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
  }, { passive: false });
  api.onAuthChange(() => { if ($("listDlg").open) refreshList(); });
}

// ---- Public API (used by main.js) ------------------------------------------------------------
export function initStudio() {
  buildRoll();
  kb = new Keyboard({
    el: $("studioKb"), wrap: $("studioKbWrap"), range: $("sRange"),
    octDown: $("sOctDown"), octUp: $("sOctUp"), onDown: liveDown, onUp: liveUp, octave: 4,
  });
  grid.addEventListener("pointerdown", onGridDown);
  grid.addEventListener("pointermove", onGridMove);
  grid.addEventListener("pointerup", onGridUp);
  grid.addEventListener("pointercancel", onGridCancel);
  grid.addEventListener("pointerleave", () => setHover(0));
  grid.addEventListener("contextmenu", (e) => e.preventDefault());
  initKeyColumn();
  initRuler();
  initToolbar();
  setTool("draw");
  renderTransport();
  renderUndo();
  loadDraft();
  renderSaveState();
  drawPlayhead();
}

/** Show (true) or hide (false) the studio; hiding stops playback and lets go of every key. */
export function setStudioActive(on) {
  if (!on) {
    stop();
    kb.releaseAll();
    live.clear();
    previewP = 0;
    lastMixKey = "";
  }
  active = on;
  if (on) {
    kb.fit();
    if (scrollPending) requestAnimationFrame(scrollToNotes);
    mix();
  }
}

/** Stop and release everything (window lost focus / tab hidden). */
export function panic() {
  stop();
  kb.releaseAll();
  for (const m of [...colPointers.values()]) if (m) liveUp(m);
  colPointers.clear();
  live.clear();
  previewP = 0;
  mix();
}

/** Studio keyboard shortcuts; returns true if the key was used. */
export function studioKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (following && (mod || ["Delete", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))) {
    return false; // read-only while following the teacher
  }
  if (mod && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
  if (mod && e.code === "KeyY") { e.preventDefault(); redo(); return true; }
  if (mod && e.code === "KeyA") { e.preventDefault(); selectOnly(melody.notes); return true; }
  if (mod && e.code === "KeyS") { e.preventDefault(); save(); return true; }
  if (mod || e.altKey) return false;
  switch (e.code) {
    case "Space":
      e.preventDefault();
      if (!e.repeat) togglePlay();
      return true;
    case "Delete":
    case "Backspace":
      e.preventDefault();
      deleteSelected();
      return true;
    case "Escape":
      selectOnly([]);
      return true;
    case "ArrowUp":
    case "ArrowDown":
      if (!sel.size) return false;
      e.preventDefault();
      nudge(0, (e.code === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1));
      return true;
    case "ArrowLeft":
    case "ArrowRight":
      if (!sel.size) return false;
      e.preventDefault();
      nudge((e.code === "ArrowRight" ? 1 : -1) * (snap || 0.25), 0);
      return true;
  }
  return kb.keyDown(e);
}

export function studioKeyUp(e) { kb.keyUp(e); }

// ---- Lessons -----------------------------------------------------------------------------
/** fn(kind) after an edit ("edit"), a play/stop/seek ("transport") or opening a melody ("load"). */
export const onStudioChange = (fn) => studioListeners.add(fn);

/** What a live teacher shares: the melody (notes as text), the playhead, playing or not. */
export function studioState() {
  return {
    melody: { name: melody.name || DEFAULT_NAME, bpm: melody.bpm, notes: api.encodeNotes(plainNotes()) },
    playhead: Math.round(pos() * 1000) / 1000,
    playing,
  };
}

/** One line about what I'm doing, for the teacher's list. */
export function studioDetail() {
  if (following) return "following the teacher's piano roll";
  return `${playing ? "playing" : "editing"} "${melody.name || DEFAULT_NAME}"`;
}

let lastFollowKey = "";
/**
 * Show the live teacher's piano roll, read-only, in step with their playback:
 * st = {teacher, melody: {name, bpm, notes: "p:s:d …"}, playhead, playing}.
 * null goes back to my own melody, as I left it.
 */
export function followTeacher(st) {
  if (!st) {
    if (!following) return;
    following = null;
    lastFollowKey = "";
    $("sFollowBar").hidden = true;
    document.body.classList.remove("following");
    const own = ownWork;
    ownWork = null;
    if (own) {
      load(own.melody);
      dirty = own.dirty;
      renderSaveState();
    }
    return;
  }
  if (!following) {
    ownWork = {
      melody: { id: melody.id, name: melody.name, bpm: melody.bpm, notes: plainNotes(), public: melody.public, owner: melody.owner },
      dirty,
    };
    $("sFollowBar").hidden = false;
    document.body.classList.add("following");
  }
  following = st;
  $("sFollowText").textContent = `Following ${st.teacher || "the teacher"}'s piano roll (read-only)`;
  const m = st.melody || {};
  const key = JSON.stringify([m.name, m.bpm, m.notes]);
  if (key !== lastFollowKey) {
    lastFollowKey = key;
    load({ id: null, name: m.name || "", bpm: m.bpm || 120, notes: api.decodeNotes(m.notes || "") });
  }
  const at = Number(st.playhead) || 0;
  if (st.playing) {
    if (playing) { anchorBeat = at; anchorTime = performance.now(); } else { cursor = at; play(); }
  } else {
    stop();
    cursor = at;
    drawPlayhead();
  }
}

/** Show on the studio keyboard what the live teacher is playing. */
export function setTeacherNotes(midi) {
  kb?.setTeacher(midi);
}
