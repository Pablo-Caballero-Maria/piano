// The page's mode follows the address (#piano / #studio) and is remembered.
import { act, renderHook, waitFor } from "../render";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "@/hooks/useMode";

describe("useMode", () => {
  beforeEach(() => history.replaceState(null, "", "/"));

  it("starts from the address, else what this browser remembers, else the piano", async () => {
    localStorage.setItem("piano-mode", "studio");
    const remembered = renderHook(() => useMode());
    await waitFor(() => expect(remembered.result.current[0]).toBe("studio"));
    expect(location.hash).toBe("#studio");
    remembered.unmount();

    history.replaceState(null, "", "/#piano");
    const fromAddress = renderHook(() => useMode());
    await waitFor(() => expect(fromAddress.result.current[0]).toBe("piano"));
  });

  it("follows where a hash change went, even if the address was rewritten meanwhile", async () => {
    const { result } = renderHook(() => useMode());
    await waitFor(() => expect(result.current[0]).toBe("piano"));
    // The address went to #studio, but by the time the event arrives it reads #piano again
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange", { newURL: `${location.origin}/#studio` }));
    });
    expect(result.current[0]).toBe("studio");
    await waitFor(() => expect(location.hash).toBe("#studio"));
    expect(localStorage.getItem("piano-mode")).toBe("studio");
  });

  it("setMode changes it", async () => {
    const { result } = renderHook(() => useMode());
    await waitFor(() => expect(result.current[0]).toBe("piano"));
    act(() => result.current[1]("studio"));
    await waitFor(() => expect(location.hash).toBe("#studio"));
  });
});
