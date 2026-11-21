// The Studio's engine on a jsdom page: editing, undo, playback, recording, drafts, following.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freqOf, resultant } from "@/lib/notes";
import { StudioEngine } from "@/studio/engine";

const key = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { code, ...mods });

function setup() {
  let now = 0;
  const outputs: number[] = [];
  const sound = { output: vi.fn((f: number) => outputs.push(f)), unlockAudio: vi.fn(), click: vi.fn() };
  const toast = vi.fn();
  const studio = new StudioEngine({ sound, toast, now: () => now });
  const roll = document.createElement("div");
  document.body.append(roll);
  studio.attach(roll);
  studio.setActive(true);
  return {
    studio,
    roll,
    sound,
    toast,
    outputs,
    /** Let `ms` pass (the engine's clock and its timers). */
    advance(ms: number) {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
    notes: () => studio.current().draft.notes,
  };
}

const SONG = {
  id: "m1",
  name: "Song",
  bpm: 120,
  notes: [
    { p: 60, s: 0, d: 1 },
    { p: 64, s: 1, d: 1 },
  ],
  public: false,
  owner: "ana",
};

describe("StudioEngine", () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("draws the roll: a row per note C1–B8, and the melody's notes", () => {
    const { studio, roll } = setup();
    expect(roll.querySelectorAll(".pk")).toHaveLength(96);
    studio.load(SONG);
    expect(roll.querySelectorAll(".note")).toHaveLength(2);
    expect(roll.querySelector(".note span")?.textContent).toBe("C4");
    expect(studio.store.get()).toMatchObject({
      id: "m1",
      name: "Song",
      bpm: 120,
      dirty: false,
      canUndo: false,
    });
  });

  it("shares the melody as text, and says what I'm doing", () => {
    const { studio } = setup();
    studio.load(SONG);
    expect(studio.studioState()).toEqual({
      melody: { name: "Song", bpm: 120, notes: "60:0:1 64:1:1" },
      playhead: 0,
      playing: false,
    });
    expect(studio.studioDetail()).toBe('editing "Song"');
  });

  it("select all, delete, undo and redo with the keyboard", () => {
    const { studio, notes, roll } = setup();
    studio.load(SONG);
    const edits = vi.fn();
    studio.changes.on(edits);
    expect(studio.keyDown(key("KeyA", { ctrlKey: true }))).toBe(true);
    expect(roll.querySelectorAll(".note.sel")).toHaveLength(2);
    studio.keyDown(key("Delete"));
    expect(notes()).toEqual([]);
    expect(studio.store.get()).toMatchObject({ dirty: true, canUndo: true });
    studio.keyDown(key("KeyZ", { ctrlKey: true }));
    expect(notes()).toEqual(SONG.notes);
    studio.keyDown(key("KeyY", { ctrlKey: true }));
    expect(notes()).toEqual([]);
    expect(edits).toHaveBeenCalledWith("edit");
  });

  it("arrow keys move the selection (Shift: an octave), within the roll", () => {
    const { studio, notes } = setup();
    studio.load({ ...SONG, notes: [{ p: 118, s: 1, d: 1 }] });
    expect(studio.keyDown(key("ArrowUp"))).toBe(false); // nothing selected
    studio.keyDown(key("KeyA", { ctrlKey: true }));
    studio.keyDown(key("ArrowUp"));
    studio.keyDown(key("ArrowUp")); // B8 is the top
    expect(notes()[0]!.p).toBe(119);
    studio.keyDown(key("ArrowDown", { shiftKey: true }));
    studio.keyDown(key("ArrowLeft"));
    expect(notes()).toEqual([{ p: 107, s: 0.75, d: 1 }]);
  });

  it("the tempo stays between 20 and 400, and can be undone", () => {
    const { studio } = setup();
    expect(studio.setBpm(999)).toBe(400);
    expect(studio.setBpm(Number("x"))).toBe(120);
    expect(studio.setBpm(5)).toBe(20);
    studio.undo();
    expect(studio.store.get().bpm).toBe(120);
  });

  it("plays the melody: each note, then silence at the end", () => {
    const { studio, outputs, advance } = setup();
    studio.load(SONG); // 120 BPM: a beat is 500 ms
    studio.play();
    expect(outputs.at(-1)).toBe(freqOf(60));
    expect(studio.store.get()).toMatchObject({ playing: true, sounding: [60] });
    advance(500);
    expect(outputs.at(-1)).toBe(freqOf(64));
    advance(500);
    expect(outputs.at(-1)).toBe(0);
    expect(studio.store.get().playing).toBe(false);
  });

  it("overlapping notes sound as their resultant frequency", () => {
    const { studio, outputs } = setup();
    studio.load({
      ...SONG,
      notes: [
        { p: 60, s: 0, d: 2 },
        { p: 64, s: 0, d: 2 },
      ],
    });
    studio.play();
    expect(outputs.at(-1)).toBe(resultant([60, 64]));
    studio.stop();
  });

  it("records what's played on the keyboard, snapped to the grid; one undo removes the take", () => {
    const { studio, advance, notes } = setup();
    studio.toggleRecord();
    expect(studio.store.get()).toMatchObject({ playing: true, recording: true });
    advance(260); // ~half a beat
    studio.keyDown(key("KeyA")); // C4
    advance(500);
    studio.keyUp(new KeyboardEvent("keyup", { code: "KeyA" }));
    studio.toggleRecord();
    expect(notes()).toEqual([{ p: 60, s: 0.5, d: 1 }]);
    studio.undo();
    expect(notes()).toEqual([]);
  });

  it("keeps a draft in this browser, restored on the next visit", () => {
    const { studio } = setup();
    studio.load({ ...SONG, id: null });
    studio.setName("My tune");
    vi.advanceTimersByTime(500);
    const again = new StudioEngine({ sound: { output() {}, unlockAudio() {}, click() {} }, toast() {} });
    again.attach(document.createElement("div"));
    expect(again.store.get()).toMatchObject({ name: "My tune", dirty: true });
    expect(again.current().draft.notes).toEqual(SONG.notes);
  });

  it("leaving the page stores the latest edit at once", () => {
    const { studio } = setup();
    studio.load({ ...SONG, id: null });
    studio.setName("Just typed");
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem("piano-studio-draft")!).name).toBe("Just typed");
  });

  it("follows the teacher's roll read-only, then goes back to my melody as I left it", () => {
    const { studio, notes, roll } = setup();
    studio.load(SONG);
    studio.setName("Song (mine)");
    studio.follow({
      teacher: "Profe",
      melody: { name: "Lesson", bpm: 90, notes: "67:0:4" },
      playhead: 2,
      playing: false,
    });
    expect(studio.store.get()).toMatchObject({ following: "Profe", name: "Lesson", bpm: 90 });
    expect(roll.querySelector(".roll-grid")?.classList.contains("readonly")).toBe(true);
    studio.keyDown(key("KeyA", { ctrlKey: true }));
    studio.keyDown(key("Delete"));
    expect(notes()).toEqual([{ p: 67, s: 0, d: 4 }]); // read-only
    expect(studio.studioDetail()).toBe("following the teacher's piano roll");
    studio.follow(null);
    expect(studio.store.get()).toMatchObject({ following: null, name: "Song (mine)", dirty: true });
    expect(notes()).toEqual(SONG.notes);
  });

  it("follows the teacher's playback", () => {
    const { studio } = setup();
    const roll = {
      teacher: "Profe",
      melody: { name: "L", bpm: 120, notes: "60:0:8" },
      playhead: 1,
      playing: true,
    };
    studio.follow(roll);
    expect(studio.store.get().playing).toBe(true);
    expect(studio.studioState().playhead).toBe(1);
    studio.follow({ ...roll, playing: false, playhead: 3 });
    expect(studio.store.get().playing).toBe(false);
    expect(studio.studioState().playhead).toBe(3);
  });

  it("saving state: unsaved notes, saved, deleted", () => {
    const { studio } = setup();
    studio.load({ ...SONG, id: null });
    expect(studio.hasUnsavedNotes()).toBe(false);
    studio.keyDown(key("KeyA", { ctrlKey: true }));
    studio.keyDown(key("Delete"));
    studio.undo();
    expect(studio.hasUnsavedNotes()).toBe(true);
    studio.markSaved({
      id: "m9",
      name: "Song",
      bpm: 120,
      length: 2,
      noteCount: 2,
      public: true,
      owner: "ana",
      updatedAt: "",
    });
    expect(studio.store.get()).toMatchObject({ id: "m9", dirty: false, isPublic: true });
    studio.forget("m9");
    expect(studio.store.get()).toMatchObject({ id: null, dirty: true });
  });

  it("hiding the studio silences it; Ctrl+S asks to save", () => {
    const { studio, outputs } = setup();
    const save = vi.fn();
    studio.saveShortcut.on(save);
    studio.keyDown(key("KeyA"));
    expect(outputs.at(-1)).toBe(freqOf(60));
    studio.setActive(false);
    expect(studio.store.get().sounding).toEqual([]);
    studio.keyDown(key("KeyS", { ctrlKey: true }));
    expect(save).toHaveBeenCalled();
  });
});
