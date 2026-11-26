// Saving and opening melodies (the API faked).
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "@/services/api";
import { StudioEngine } from "@/studio/engine";
import { MelodyLibrary } from "@/studio/library";

const SUMMARY = {
  id: "m1",
  name: "Song",
  bpm: 120,
  length: 1,
  noteCount: 1,
  public: false,
  owner: "ana",
  updatedAt: 0,
};

function setup({ loggedIn = true, confirm = true } = {}) {
  const studio = new StudioEngine({ sound: { output() {}, unlockAudio() {}, click() {} }, toast() {} });
  const api = {
    currentUser: vi.fn(() => (loggedIn ? { username: "ana", role: "student" } : null)),
    createMelody: vi.fn(async (d: { name: string }) => ({ ...SUMMARY, id: "new", name: d.name })),
    updateMelody: vi.fn(async () => SUMMARY),
    getMelody: vi.fn(async () => ({ ...SUMMARY, notes: [{ p: 60, s: 0, d: 1 }] })),
    deleteMelody: vi.fn(async () => {}),
    listMelodies: vi.fn(async () => [SUMMARY]),
  };
  const deps = {
    api: api as unknown as ApiClient,
    toast: vi.fn(),
    confirm: vi.fn(async () => confirm),
    openAuth: vi.fn(async () => false),
  };
  const library = new MelodyLibrary(studio, deps);
  return { studio, api, deps, library };
}

describe("MelodyLibrary", () => {
  it("saves a new melody, then updates it", async () => {
    const { studio, api, library, deps } = setup();
    studio.load({ id: null, name: "", bpm: 100, notes: [{ p: 62, s: 0, d: 1 }] });
    await library.save();
    expect(api.createMelody).toHaveBeenCalledWith({
      name: "Untitled melody",
      bpm: 100,
      notes: [{ p: 62, s: 0, d: 1 }],
      public: false,
    });
    expect(studio.store.get()).toMatchObject({ id: "new", dirty: false });
    expect(deps.toast).toHaveBeenCalledWith('Saved "Untitled melody"');
    await library.save();
    expect(api.updateMelody).toHaveBeenCalledWith("new", expect.objectContaining({ bpm: 100 }));
  });

  it("a melody deleted meanwhile (404) is saved as a new one", async () => {
    const { studio, api, library } = setup();
    studio.load({ id: "gone", name: "X", bpm: 120, notes: [] });
    api.updateMelody.mockRejectedValueOnce(new ApiError("Not found", 404));
    await library.save();
    expect(api.createMelody).toHaveBeenCalled();
  });

  it("asks to log in first; nothing is saved if the user doesn't", async () => {
    const { api, library, deps } = setup({ loggedIn: false });
    await library.save();
    expect(deps.openAuth).toHaveBeenCalled();
    expect(api.createMelody).not.toHaveBeenCalled();
  });

  it("errors are shown, and saving can be tried again", async () => {
    const { api, library, deps } = setup();
    api.createMelody.mockRejectedValueOnce(new ApiError("Can't reach the server", 0));
    await library.save();
    expect(deps.toast).toHaveBeenCalledWith("Can't reach the server", "error");
    expect(library.saving.get()).toBe(false);
  });

  it("opening asks before throwing away unsaved notes", async () => {
    const { studio, library, deps } = setup({ confirm: false });
    studio.load({ id: null, name: "Mine", bpm: 120, notes: [] });
    studio.setName("Mine!");
    expect(await library.open("m1")).toBe(true); // no notes to lose: no question
    studio.setName("changed"); // unsaved, with notes
    expect(await library.open("m1")).toBe(false);
    expect(deps.confirm).toHaveBeenCalledWith('"changed" has unsaved changes. Discard them?', "Discard");
  });

  it("copies and deletes", async () => {
    const { studio, api, library } = setup();
    const changed = vi.fn();
    library.changed.on(changed);
    await library.duplicate("m1");
    expect(api.createMelody).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Song (copy)", public: false }),
    );
    studio.load({ ...SUMMARY, notes: [] });
    await library.remove(SUMMARY);
    expect(api.deleteMelody).toHaveBeenCalledWith("m1");
    expect(studio.store.get()).toMatchObject({ id: null, dirty: true });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
