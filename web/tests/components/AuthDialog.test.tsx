// Logging in and creating an account.
import { act, fireEvent, render, screen, waitFor } from "../render";
import { describe, expect, it, vi } from "vitest";
import { AuthDialog } from "@/components/dialogs/AuthDialog";
import { ApiError } from "@/services/api";
import { api } from "@/services";
import { openAuth } from "@/state/dialogs";
import { toastStore } from "@/state/toast";

function fill(user: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: user } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

/** The form's submit button (the "Log in" tab has the same name). */
const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe("AuthDialog", () => {
  it("logs in and resolves openAuth()", async () => {
    vi.spyOn(api, "login").mockImplementation(async (username) => {
      api.session.set({ token: "t", user: { username, role: "student" } });
      return "";
    });
    render(<AuthDialog />);
    let result: Promise<boolean> | undefined;
    act(() => void (result = openAuth("Log in to save")));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Log in to save")).toBeInTheDocument();
    fill(" ana ", "secret1");
    expect(submitButton()).toHaveTextContent("Log in");
    fireEvent.click(submitButton());
    expect(await result).toBe(true);
    expect(api.login).toHaveBeenCalledWith("ana", "secret1");
    expect(toastStore.get()?.message).toBe("Welcome back, ana");
    api.logout();
  });

  it("creates a teacher account", async () => {
    vi.spyOn(api, "register").mockResolvedValue("");
    render(<AuthDialog />);
    act(() => void openAuth());
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.click(screen.getByRole("button", { name: "I'm a teacher" }));
    fill("profe", "secret1");
    expect(submitButton()).toHaveTextContent("Create account");
    fireEvent.click(submitButton());
    await waitFor(() => expect(api.register).toHaveBeenCalledWith("profe", "secret1", "teacher"));
  });

  it("shows the server's error and stays open; Cancel resolves false", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiError("Wrong username or password", 401));
    render(<AuthDialog />);
    let result: Promise<boolean> | undefined;
    act(() => void (result = openAuth()));
    fill("ana", "secret1");
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await result).toBe(false);
  });
});
