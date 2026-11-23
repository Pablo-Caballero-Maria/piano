/**
 * What jsdom lacks of a real browser, for the tests; and a clean page after each test. The server's
 * tests (tests/server, Better Auth) run in Node, without a page: then only jest-dom's matchers load.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const browser = typeof window !== "undefined";

afterEach(() => {
  if (!browser) return;
  cleanup();
  localStorage.clear();
});

if (browser) setUpBrowser();

function setUpBrowser() {
  // <dialog>: showModal() / close() (with its close event)
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;

  document.elementFromPoint ??= () => null;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
}
