// The class panel, for a teacher in the classroom and for a student online.
import { act, fireEvent, render, screen } from "../render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassDialog } from "@/components/class/ClassDialog";
import { api, classState, link } from "@/services";
import { INITIAL_CLASS } from "@/state/class-state";

function as(username: string, role: "teacher" | "student") {
  api.session.set({ token: "t", user: { username, role } });
}

afterEach(() => {
  api.session.set(null);
  classState.store.set(INITIAL_CLASS);
});

describe("ClassDialog", () => {
  it("a teacher in the classroom: the lesson, the buzzer queue, who's here, the PC", async () => {
    as("Profe", "teacher");
    vi.spyOn(api, "pcStatus").mockResolvedValue({
      board: { online: true, version: "abc1234" },
      internet: false,
      sync: null,
      update: { version: "abc1234" },
    });
    const queue = vi.spyOn(link, "queue").mockImplementation(() => {});
    const live = vi.spyOn(link, "live").mockImplementation(() => {});
    classState.store.set({
      ...INITIAL_CLASS,
      status: { state: "on", text: "In class" },
      where: "classroom",
      lesson: { live: "Profe", mode: "piano" },
      buzzer: { holder: "Profe", live: "Profe", granted: null, queue: ["bo"] },
      people: [
        { id: "1", name: "Profe", role: "teacher" },
        { id: "2", name: "ana", role: "student", mode: "studio", notes: [60], detail: 'editing "x"' },
        { id: "3", name: "luis", role: "student", remote: true },
      ],
    });
    render(<ClassDialog open onClose={() => {}} mode="piano" />);
    expect(screen.getByText("Playing on the buzzer: Profe (the lesson)")).toBeInTheDocument();
    expect(screen.getByText('Studio · playing C4 · editing "x"')).toBeInTheDocument();
    expect(screen.getByText("luis · from home")).toBeInTheDocument();
    expect(await screen.findByText(/Board: online \(version abc1234\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Give buzzer" })); // only ana: luis is at home
    expect(queue).toHaveBeenCalledWith("grant", { user: "ana" });
    fireEvent.click(screen.getByRole("button", { name: "End the lesson" }));
    expect(live).toHaveBeenCalledWith(false, "piano");
    expect(screen.queryByText("Live lessons")).toBeNull();
  });

  it("a student online: the live lessons to join", () => {
    as("ana", "student");
    const follow = vi.spyOn(link, "follow").mockResolvedValue();
    vi.spyOn(link, "lessons").mockResolvedValue();
    classState.store.set({ ...INITIAL_CLASS, where: "online", teachers: ["Profe"] });
    render(<ClassDialog open onClose={() => {}} mode="piano" />);
    expect(screen.queryByText("Buzzer")).toBeNull();
    expect(screen.queryByText("Lesson")).toBeNull();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Join" })));
    expect(follow).toHaveBeenCalledWith("Profe");
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
  });
});
